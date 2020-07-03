"use strict";

const path = require("path");
const JSDriver = require("./javascript");
const HTMLDriver = require("./html");
const XPCOMClassesData = require("./utilities/mozilla/xpcom-classes");
const cacheContracts = require("./utilities/mozilla/cacheContracts");
const contractToAwaitAsyncLocations = require("./utilities/mozilla/contractToAwaitAsyncLocations");
const parseJarManifests = require("./utilities/mozilla/parseJarManifests");

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

    this.asyncTasks = [];

    this.contractToFiles = null; // new Map(contract: file[] )
  }

  async analyzeByConfiguration(config, options) {
    if (config.type === "javascript")
      return await this.analyzeByJSConfiguration(config, options);
    throw new Error("Unsupported configuration type");
  }

  async analyzeByJSConfiguration(config) {
    this.startingMarkAsync = config.markAsync;

    this.topStartAsync = null;
    this.topAsyncRefs = new Map();

    this.scheduleConfiguration(config);

    while (this.asyncTasks.length) {
      const callback = this.asyncTasks.shift();
      await callback();
    }

    const rv = {
      startAsync: this.topStartAsync,
      asyncRefs: this.topAsyncRefs
    };

    this.topAsyncRefs = null;
    this.topStartAsync = null;

    return rv;
  }

  scheduleConfiguration(config) {
    this.asyncTasks.push(async () => {
      if (!this.sourceToDriver.has(config.markAsync.path)) {
        this.buildSubDriver(config);
      }

      let driverPath = config.markAsync.path;
      if (config.type === "html")
        driverPath = config.pathToHTML;
      const subDriver = this.sourceToDriver.get(driverPath);
      let {startAsync, asyncRefs} = await subDriver.analyzeByConfiguration(config);

      this.asyncTasks.push(async () => {
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

        await this.buildSubsidiaryConfigsByComponents(asyncComponents, config);
      });
    });

    /* XXX to-do:
    Match IDL files
    */
  }

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

  async buildChromeRegistry() {
    this.chromeRegistry = await parseJarManifests(this.fullRoot);
    console.log("built chrome registry: " + this.chromeRegistry.size);
    if (!this.chromeRegistry.size)
      throw new Error("abort");
  }

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
    this.contractToFiles = await cacheContracts(this.fullRoot, data);

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

  findXPCOMComponents(name, scope) {
    const contractIds = this.ctorNameToContractIDs.get(name);
    if (!contractIds) {
      return;
    }

    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    this.xpcomComponents.add(definition.node);
  }

  async buildSubsidiaryConfigsByComponents(asyncComponents, currentConfig) {
    let promises = [];
    asyncComponents.forEach((node) => {
      const name = this.getNodeName(node);
      const contractIDs = this.ctorNameToContractIDs.get(name);
      contractIDs.forEach(contractID => {
        const fileDataSet = this.contractToFiles.get(contractID);
        fileDataSet.forEach(fileData => {
          if ("xhtmlFiles" in fileData) {
            fileData.xhtmlFiles.forEach((xhtmlFileData) => {
              promises.push(this.buildSubsidiaryConfigs(node, contractID, xhtmlFileData, fileData, currentConfig));
            });
          }
          else if (/\.jsm?$/.test(fileData.path))
            promises.push(this.buildSubsidiaryConfigs(node, contractID, fileData, fileData, currentConfig));
          else
            console.log("dropping file on floor: " + fileData.fileWithLine);
        });
      });
    });

    await Promise.all(promises);
  }

  async buildSubsidiaryConfigs(parentAsyncNode, contractID, targetFileData, jsFileData, currentConfig) {
    const {awaitLocation, asyncLocation} = await contractToAwaitAsyncLocations(
      this.rootDir,
      this.options,
      jsFileData.path,
      jsFileData.line,
      contractID,
    );

    if (!asyncLocation)
      return;

    const outConfig = {
      type: targetFileData === jsFileData ? "javascript" : "html",
      root: currentConfig.root,
      options: currentConfig.options,
      ignore: currentConfig.ignore,

      markAwait: awaitLocation,

      markAsync: {
        path: asyncLocation.path,
        line: asyncLocation.line,
        functionIndex: asyncLocation.index,
      }
    };

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

  nodeToDriverListener() {
    const nodeToDriver = this.mozillaDriver.nodeToDriver;
    return {
      enter: (node) => {
        nodeToDriver.set(node, this);
      }
    }
  },

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

  handleExportedSymbols(exported, scope) {
    const names = exported.map(n => this.getNodeName(n));
    for (let i = 0; i < names.length; i++) {
      const name = JSON.parse(names[i]);
      this.mozillaDriver.findXPCOMComponents(name, scope);
    }
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

module.exports = MozillaDriver;
