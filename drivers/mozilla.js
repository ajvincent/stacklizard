"use strict";
/**
 * @fileoverview
 *
 * The MozillaDriver is really a coordinator for several independent JSDriver's and HTMLDriver's.
 * It drives parsing of JavaScript code across many different scopes.  It does this through an
 * "async tasks" list, which is basically just an array of async callback functions.
 * Notably, the espree and estraverse tools are very synchronous, but they don't need to be
 * async, so I adapt around them.
 *
 * For the Mozilla-specific features (chrome:// URL's, contract IDs, etc.), I introduce the
 * MozillaJSDriver (for JavaScript files), and MozillaHTMLDriver (for XHTML files).  These add
 * estraverse listeners to pick up whenever we need to do something special.
 *
 * These special listeners create artificial, in-memory JSON configurations similar to
 * /sample-config-json.yaml and schedule them to run later, via
 * MozillaDriver.prototype.scheduleConfiguration().  The analyzeByConfiguration() code drives
 * the firing of the next scheduled task.
 *
 * One big reason this exists is XPCOM.  XPCOM components and services cannot be async as
 * Mozilla constructs them.  So code like this simply can't be awaited:
 *
 * let um = Cc["@mozilla.org/updates/update-manager;1"].getService(
 *   Ci.nsIUpdateManager
 * );
 *
 * To at least catch where this is an issue, StackLizard will mark the contract ID's as await
 * (even though that's meaningless in real JavaScript), and then mark the calling function as
 * async, then continue as normal with a JSDriver to mark ancestors await and async as needed.
 * This will be close enough for analysis to show the async/await stacks.
 */

const path = require("path");
const JSDriver = require("./javascript");
const HTMLDriver = require("./html");
const XPCOMClassesData = require("./utilities/mozilla/xpcom-classes");
const cacheContracts = require("./utilities/mozilla/cacheContracts");
const {
  stringToAwaitAsyncLocations,
  getLocationsDriver
} = require("./utilities/mozilla/stringToAwaitAsyncLocations");
const parseJarManifests = require("./utilities/mozilla/parseJarManifests");
const resourceModuleReferences = require("./utilities/mozilla/resourceModuleReferences");
const findJSMReferences = require("./utilities/mozilla/findJSMReferences");

class MozillaDriver {
  constructor(rootDir, options = {}) {
    /**
     * The root directory.
     * @private
     */
    this.rootDir = rootDir;

    /**
     * Configuration options.
     * @private
     */
    this.options = options;

    this.cwd = process.cwd();
    this.fullRoot = path.resolve(this.cwd, this.rootDir);

    // new Map( chrome://packagename/content/path/to/file => absolute/path/to/local/file )
    this.chromeRegistry = null;

    this.ctorNameToContractIDs = new Map(/*
      constructor name: [ contract id, ... ]
    */);

    this.xpcomComponents = new WeakSet(/*
      AST node, ...
    */);

    this.sourceToDriver = new Map(/*
      pathToFile: MozillaJSDriver || MozillaHTMLDriver
    */);

    this.nodeToDriver = new Map(/* node: JSDriver */);

    this.ignoredNodes = new Set(/* node */);

    this.asyncTasks = [/* async function() */];

    this.contractToFiles = null; // new Map( contract: file[] )

    this.jsmExportReferences = new Map(/* node in JSM: node[] */);
  }

  /**
   * Perform an analysis based on a configuration.
   *
   * @param {JSONObject} config      The configuration for this driver.
   * @param {Object}     adjustments Adjustments to the configuration (usually from command-line).
   *
   * @public
   * @returns {Object} A dictionary object:
   *   startAsync: The start node indicated by config.markAsync.
   *   asyncRefs:  Map() of async nodes to corresponding await nodes and their async callers.
   */
  async analyzeByConfiguration(config) {
    this.baseConfiguration = config;
    if (config.type === "javascript")
      return await this.analyzeByJSConfiguration(config);
    throw new Error("Unsupported configuration type");
  }

  /**
   * Perform an analysis based on a JavaScript configuration.
   *
   * @param {JSONObject} config      The configuration for this driver.
   * @param {Object}     adjustments Adjustments to the configuration (usually from command-line).
   *
   * @private
   * @returns {Object} A dictionary object:
   *   startAsync: The start node indicated by config.markAsync.
   *   asyncRefs:  Map() of async nodes to corresponding await nodes and their async callers.
   */
  async analyzeByJSConfiguration(config) {
    this.startingMarkAsync = config.markAsync;

    this.topStartAsync = null;
    this.topAsyncRefs = new Map();

    console.log("Starting first scheduleConfiguration");
    this.scheduleConfiguration(config);

    while (this.asyncTasks.length) {
      const callback = this.asyncTasks.shift();
      await callback();
    }

    this.cleanAsyncDuplicates();

    const rv = {
      startAsync: this.topStartAsync,
      asyncRefs: this.topAsyncRefs
    };

    this.topAsyncRefs = null;
    this.topStartAsync = null;

    return rv;
  }

  /**
   * Schedule processing of a XHTML or JS file by a configuration (real or artificial).
   *
   * @param {Object} config  The configuration.
   *
   * @private
   */
  scheduleConfiguration(config) {
    this.asyncTasks.push(async () => {
      // Start processing.
      if (!this.sourceToDriver.has(config.markAsync.path)) {
        this.buildSubDriver(config);
      }

      // Parse the files specified by the configuration.
      let driverPath = config.markAsync.path;
      if (config.type === "html")
        driverPath = config.pathToHTML;
      const subDriver = this.sourceToDriver.get(driverPath);
      let {startAsync, asyncRefs} = await subDriver.analyzeByConfiguration(config);

      this.asyncTasks.push(async () => {
        // Import our data from the subsidiary driver.
        const asyncComponents = [];

        if (!this.topStartAsync)
          this.topStartAsync = startAsync;
        asyncRefs.forEach((value, key) => {
          if (this.topAsyncRefs.has(key))
            return;
          this.topAsyncRefs.set(key, value);

          value.forEach(({asyncNode}) => {
            if (this.xpcomComponents.has(asyncNode))
              asyncComponents.push(asyncNode);
          });
        });

        Array.from(subDriver.ignoredNodes.values).forEach(value => this.ignoredNodes.add(value));

        // Schedule future configurations based on XPCOM components we marked async.
        await this.buildSubsidiaryConfigsByComponents(asyncComponents, config);
      });
    });

    /* XXX to-do:
    Match IDL files
    */
  }

  /**
   * Build a JSDriver for parsing Mozilla-specific JavaScripts.
   *
   * @param {Object} config
   *
   * @private
   * @returns {JSDriver} The driver.
   */
  buildSubDriver(config) {
    let driver;
    if (config.type === "javascript") {
      driver = new MozillaJSDriver(this, config.root, this.options);
      this.sourceToDriver.set(config.markAsync.path, driver);
    }
    else if (config.type === "html") {
      driver = new MozillaHTMLDriver(this, config.root, this.options);
      this.sourceToDriver.set(config.pathToHTML, driver);
    }
  }

  /**
   * Gather the mapping of chrome:// URL's to local filesystem files.
   * @private
   */
  async buildChromeRegistry() {
    this.chromeRegistry = await parseJarManifests(this.fullRoot);
    console.log("built chrome registry: " + this.chromeRegistry.size);
    if (!this.chromeRegistry.size)
      throw new Error("abort");
  }

  async gatherResourceModuleReferences() {
    this.jsmReferences = await resourceModuleReferences(this.fullRoot);
  }

  async scheduleFindJSMReferences(pathToFile, names, scope) {
    const loaders = this.jsmReferences.get(path.basename(pathToFile));
    console.log(names, loaders);

    loaders.forEach(loader => {
      this.asyncTasks.push(async () => {
        if (loader.fileWithLine.endsWith(".xhtml"))
          throw new Error("Need HTML driver for " + loader.fileWithLine);

        const { awaitLocation } = await stringToAwaitAsyncLocations(
          this.fullRoot,
          this.options,
          loader.path,
          loader.line,
          loader.literal
        );

        const driver = await getLocationsDriver(this.fullRoot, this.options, loader.path);
        findJSMReferences(this, awaitLocation, driver, scope);
      });
    });
  }

  markExportLocation(sourceNode, targetNode, name) {
    // this is very temporary code until I figure out how to handle this
    let rv = "markExportLocation(" + name + "): ";
    const sourceDriver = this.nodeToDriver.get(sourceNode);
    if (sourceDriver)
      rv += "source: " + sourceDriver.serializeNode(sourceNode) + " ";
    const targetDriver = this.nodeToDriver.get(targetNode);
    if (targetDriver)
      rv += "target: " + targetDriver.serializeNode(targetNode) + " ";
    else
      rv += "unknown target: " + targetNode.file + ": " + targetNode.line;
    console.log(rv);
  }

  /**
   * Map constructor names to contract ID's.
   *
   * @private
   */
  async gatherXPCOMClassData() {
    const data = await XPCOMClassesData(this.fullRoot);

    /*
    new Map(
      contractID: [
        {
          fileWithLine,
          path,
          line,
          source,
          xhtmlFiles: [
            {
              fileWithLine,
              path,
              line,
              source,
            }
          ]
        }
      ]
    )
    */
    console.timeLog("mozilla", "Gathering contract locations");
    this.contractToFiles = await cacheContracts(this.fullRoot, data);
    console.timeLog("mozilla", "Finished contract locations");

    data.forEach(item => {
      if (!Reflect.ownKeys(item).includes("constructor") ||
          !Reflect.ownKeys(item).includes("contract_ids"))
        return;

      if (this.ctorNameToContractIDs.has(item.constructor)) {
        console.error(this.ctorNameToContractIDs.get(item.constructor));
        console.error(item);
        throw new Error("duplicated constructor name");
      }

      this.ctorNameToContractIDs.set(
        item.constructor,
        item.contract_ids
      );
    });

    console.log("count of constructors mapped to contract ID's: " + this.ctorNameToContractIDs.size);
  }

  /**
   * Find XPCOM components in a given scope and record their constructor nodes.
   *
   * @param {string} name The constructor's name.
   * @param {Object} scope An estraverse global scope object.
   *
   * @protected
   */
  findXPCOMComponents(name, scope) {
    const contractIds = this.ctorNameToContractIDs.get(name);
    if (!contractIds) {
      return;
    }

    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    this.xpcomComponents.add(definition.node);
  }

  /**
   * Clone a configuration and adjust it for additional JavaScript files to parse in new scopes.
   * @param {Node[]} asyncComponents The components we need to mark async.
   * @param {Object} currentConfig   The current configuration.
   *
   * @private
   */
  async buildSubsidiaryConfigsByComponents(asyncComponents, currentConfig) {
    let promises = [];
    asyncComponents.forEach((parentAsyncNode) => {
      const name = this.getNodeName(parentAsyncNode);
      const contractIDs = this.ctorNameToContractIDs.get(name);

      contractIDs.forEach(contractID => {
        const fileDataSet = this.contractToFiles.get(contractID);

        fileDataSet.forEach(fileData => {
          promises.push(this.buildSubsidiaryComponentConfigs(
            contractID, fileData, parentAsyncNode, currentConfig
          ));
        });
      });
    });

    await Promise.all(promises);
  }

  async buildSubsidiaryComponentConfigs(contractID, fileData, parentAsyncNode, currentConfig) {
    const {awaitLocation, asyncLocation} = await stringToAwaitAsyncLocations(
      this.rootDir,
      this.options,
      fileData.path,
      fileData.line,
      contractID
    );
    if (!asyncLocation)
      return;

    if ("xhtmlFiles" in fileData) {
      fileData.xhtmlFiles.forEach((xhtmlFileData) => {
        this.buildSubsidiaryConfiguration(
          parentAsyncNode, awaitLocation, asyncLocation, xhtmlFileData, fileData, currentConfig
        );
      });
    }
    else if (/\.jsm?$/.test(fileData.path))
      this.buildSubsidiaryConfiguration(
        parentAsyncNode, awaitLocation, asyncLocation, fileData, fileData, currentConfig
      );
    else
      console.log("dropping file on floor: " + fileData.fileWithLine);
  }

  /**
   * Clone a configuration and adjust it for additional JavaScript files to parse in new scopes.
   *
   * @param {Node}   parentAsyncNode The component constructor's AST node.
   * @param {Object} targetFileData  The JS or XHTML file needing parsing.
   * @param {Object} jsFileData      The location of the node to mark async in the target.
   * @param {Object} currentConfig   The current configuration.
   */
  buildSubsidiaryConfiguration(
    parentAsyncNode,
    awaitLocation,
    asyncLocation,
    targetFileData,
    jsFileData,
    currentConfig
  )
  {
    const outConfig = {
      type: targetFileData === jsFileData ? "javascript" : "html",
      root: currentConfig.root,
      options: currentConfig.options,
      ignore: currentConfig.ignore,

      // technically not needed yet, but it doesn't hurt
      markAwait: awaitLocation,

      markAsync: {
        path: asyncLocation.path,
        line: asyncLocation.line,
        functionIndex: asyncLocation.index,
      }
    };

    if (Array.isArray(currentConfig.debugByLine)) {
      outConfig.debugByLine = currentConfig.debugByLine.slice(0);
    }

    if (outConfig.type === "javascript") {
      outConfig.scripts = [ targetFileData.path ];
    }
    if (outConfig.type === "html") {
      outConfig.pathToHTML = targetFileData.path;
    }

    this.scheduleConfiguration(outConfig);

    // need to tie the awaitNode and asyncNode to their parent async node
    this.asyncTasks.push(() => {
      if (!this.topAsyncRefs.has(parentAsyncNode)) {
        this.topAsyncRefs.set(parentAsyncNode, []);
      }

      const subDriver = this.sourceToDriver.get(targetFileData.path);
      if (!subDriver) {
        console.error("Couldn't find subDriver: " + targetFileData.path);
        console.error(Array.from(this.sourceToDriver.entries()).join("\n"));
        throw new Error("Couldn't find subDriver: " + targetFileData.path);
      }

      const asyncNode = subDriver.functionNodeFromLine(
        asyncLocation.path,
        asyncLocation.line,
        asyncLocation.index
      );

      const awaitNode = subDriver.nodeByLineFilterIndex(
        awaitLocation.path,
        awaitLocation.line,
        awaitLocation.index,
        n => n.type === "Literal"
      );

      this.topAsyncRefs.get(parentAsyncNode).push({
        awaitNode,
        asyncNode
      });
    });
  }

  async gatherXPTData() {
    // objdir/config/makefiles/xpidl/*.xpt
    throw new Error("Not yet implemented");
  }

  cleanAsyncDuplicates() {
    this.topAsyncRefs.forEach((value, key) => {
      value.sort(compareAwaitAsync);
      this.topAsyncRefs.set(key, value.filter(filterAwaitAsyncForDuplicates));
    });
  }

  // utilities for MozillaJSDriver, MozillaHTMLDriver.

  getNodeName(node) {
    const subDriver = this.nodeToDriver.get(node);
    return subDriver.getNodeName(node);
  }

  serializeNode(node) {
    const subDriver = this.nodeToDriver.get(node);
    let rv = subDriver.serializeNode(node);
    if (this.xpcomComponents.has(node))
      rv += ", XPCOM component";
    return rv;
  }

  isAsyncSyntaxError(node) {
    if (this.xpcomComponents.has(node))
      return true;
    const subDriver = this.nodeToDriver.get(node);
    return subDriver.isAsyncSyntaxError(node);
  }
}

/**
 * Prototype methods for MozillaJSDriver, MozillaHTMLDriver.
 */
const MozillaMixinDriver = {
  install(thisObj) {
    Reflect.ownKeys(this).forEach(key => {
      if (key === "install")
        return;
      thisObj[key] = this[key];
    });
  },

  /**
   * Add extra listeners for special metadata.
   *
   * @param {MultiplexListeners} traverseListeners
   * @private
   */
  appendExtraListeners(traverseListeners) {
    traverseListeners.append(this.nodeToDriverListener());
    traverseListeners.append(this.exportedSymbolsListener());
  },

  /**
   * Build an estraverse listener for mapping nodes to their subsidiary driver.
   *
   * @private
   */
  nodeToDriverListener() {
    const nodeToDriver = this.mozillaDriver.nodeToDriver;
    return {
      enter: (node) => {
        nodeToDriver.set(node, this);
      }
    }
  },

  /**
   * Build an estraverse listener to handle the special EXPORTED_SYMBOLS value in .jsm files.
   *
   * @private
   */
  exportedSymbolsListener() {
    return {
      enter: (node) => {
        let scope = this.nodeToScope.get(node);
        // JSM scope check?
        if (scope.upper)
          return;

        if ((node.type === "VariableDeclarator") &&
            (this.getNodeName(node.id) === "EXPORTED_SYMBOLS") &&
            (node.init.type === "ArrayExpression")) {
          this.mozillaDriver.asyncTasks.unshift(async () =>
            this.handleExportedSymbols(node.init.elements, scope)
          );
        }
        else if ((node.type === "AssignmentExpression") &&
                 (this.getNodeName(node.left) === "EXPORTED_SYMBOLS") &&
                 (node.right.type === "ArrayExpression")) {
          this.mozillaDriver.asyncTasks.unshift(async () => {
            this.handleExportedSymbols(node.right.elements, scope);
          });
        }
      }
    };
  },

  /**
   * Extract components from the EXPORTED_SYMBOLS value of a scope.
   *
   * @param {Node[]} exported The exported names as AST nodes.
   * @param {Object} scope    The estraverse scope.
   *
   * @private
   */
  handleExportedSymbols(exported, scope) {
    const names = exported.map(n => this.getNodeName(n));
    for (let i = 0; i < names.length; i++) {
      const name = JSON.parse(names[i]);
      this.mozillaDriver.findXPCOMComponents(name, scope);
    }
    this.mozillaDriver.scheduleFindJSMReferences(exported[0].file, names, scope);
  },
};

class MozillaJSDriver extends JSDriver {
  constructor(owner, rootDir, options) {
    super(rootDir, options);
    this.mozillaDriver = owner;
  }
}
MozillaMixinDriver.install(MozillaJSDriver.prototype);

class MozillaHTMLDriver extends HTMLDriver {
  constructor(owner, rootDir, options) {
    super(rootDir, options);
    this.mozillaDriver = owner;
  }

  /**
   * Convert chrome:// URL's to absolute file paths.
   *
   * @param {string} baseHref     The base href.
   * @param {string} relativePath The relative URL to resolve.
   *
   * @private
   * @returns {string} The corrected location to load.
   *
   */
  resolveURI(baseHref, relativePath) {
    if (relativePath.startsWith("chrome://")) {
      if (!this.mozillaDriver.chromeRegistry.has(relativePath)) {
        throw new Error("uh oh");
      }
      relativePath = this.mozillaDriver.chromeRegistry.get(relativePath);
      baseHref = "";
    }
    return HTMLDriver.prototype.resolveURI.apply(this, [baseHref, relativePath]);
  }
}
MozillaMixinDriver.install(MozillaHTMLDriver.prototype);

function compareAwaitAsync(a, b) {
  if (a.awaitNode && !b.awaitNode)
    return -1;
  if (b.awaitNode && !a.awaitNode)
    return +1;
  if (a.awaitNode) {
    if (a.awaitNode.file < b.awaitNode.file)
      return -1;
    if (a.awaitNode.file > b.awaitNode.file)
      return +1;
    let sign = Math.sign(a.awaitNode.line - b.awaitNode.line);
    if (sign !== 0)
      return sign;
  }

  if (a.asyncNode && !b.asyncNode)
    return -1;
  if (b.asyncNode && !a.asyncNode)
    return +1;
  if (a.asyncNode) {
    if (a.asyncNode.file < b.asyncNode.file)
      return -1;
    if (a.asyncNode.file > b.asyncNode.file)
      return +1;
    let sign = Math.sign(a.asyncNode.line - b.asyncNode.line);
    if (sign !== 0)
      return sign;
  }
  return 0;
}

function filterAwaitAsyncForDuplicates(item, index, array) {
  if (index === 0)
    return true;
  const previousItem = array[index - 1];
  const previousNode = previousItem.awaitNode || previousItem.asyncNode;
  const node = item.awaitNode || item.asyncNode;

  return (previousNode.file !== node.file) || (previousNode.line !== node.line);
}

module.exports = MozillaDriver;
