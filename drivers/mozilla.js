"use strict";

/*
const fs = require("fs").promises;
*/
const path = require("path");
const JSDriver = require("./javascript");
const XPCOMClassesData = require("./utilities/mozilla/xpcom-classes");
const getLiteralLocations = require("./utilities/mozilla/getLiteralLocations");

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

    this.asyncQueue = null;
  }

  async analyzeByConfiguration(config, options) {
    if (config.type === "javascript")
      return await this.analyzeByJSConfiguration(config, options);
    throw new Error("Unsupported configuration type");
  }

  async analyzeByJSConfiguration(config, options) {
    this.startingMarkAsync = config.markAsync;

    this.scheduledConfigs = [config];
    let topMarkAsync = null, topAsyncRefs = new Map();
    this.asyncQueue = [];

    for (let i = 0; i < this.scheduledConfigs.length; i++) {
      const currentConfig = this.scheduledConfigs[i];
      if (!this.sourceToDriver.has(currentConfig.markAsync.path)) {
        await this.buildSubDriver(currentConfig, options);
      }

      const subDriver = this.sourceToDriver.get(currentConfig.markAsync.path);
      let {markAsync, asyncRefs} = await subDriver.analyzeByConfiguration(currentConfig);

      while (this.asyncQueue.length)
        await this.asyncQueue.shift()();

      if (i === 0)
        topMarkAsync = markAsync;
      asyncRefs.forEach((value, key) => {
        if (!topAsyncRefs.has(key))
          topAsyncRefs.set(key, value);
      });

      Array.from(subDriver.ignoredNodes.values).forEach(value => this.ignoredNodes.add(value));
    }

    return {
      markAsync: topMarkAsync,
      asyncRefs: topAsyncRefs
    };
  }

  async buildSubDriver(config, options) {
    let driver;
    if (config.type === "javascript") {
      driver = new MozillaJSDriver(this, config.root, options);
    }
    this.sourceToDriver.set(config.markAsync.path, driver);
  }

  async gatherXPCOMClassData() {
    const data = await XPCOMClassesData(this.fullRoot);

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
    console.log("ctorName count:" + this.ctorNameToContractIDs.size);
  }

  async findXPCOMComponents(name, scope) {
    const contractIds = this.ctorNameToContractIDs.get(name);
    if (!contractIds) {
      return;
    }

    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    this.xpcomComponents.add(definition.node);

    let contractLocations = await Promise.all(contractIds.map(
      contract => getLiteralLocations(this.fullRoot, contract)
    ));
    contractLocations = contractLocations.flat().filter(Boolean);
    console.log(JSON.stringify(contractLocations, null, 2));
    throw new Error("Not yet implemented");

    // This is where we add to this.scheduledConfigs.
    /* XXX to-do:
    Match contract ID's to additional scopes
    Match IDL files
    Load additional scopes
    */
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
    const subDriver = this.nodeToDriver.get(node);
    return (subDriver.isAsyncSyntaxError(node) || this.xpcomComponents.has(node))
  }
}

class MozillaJSDriver extends JSDriver {
  constructor(owner, rootDir, options) {
    super(rootDir, options);
    this.mozillaDriver = owner;
  }

  /**
   * Add extra listeners for special metadata.
   *
   * @param {MultiplexListeners} traverseListeners
   * @private
   */
  appendExtraListeners(traverseListeners) {
    traverseListeners.append(this.nodeToDriverListener());
    traverseListeners.append(this.exportedSymbolsListener());
  }

  nodeToDriverListener() {
    const nodeToDriver = this.mozillaDriver.nodeToDriver;
    return {
      enter: (node) => {
        nodeToDriver.set(node, this);
      }
    }
  }

  exportedSymbolsListener() {
    const driver = this;
    return {
      enter: (node) => {
        let scope = this.nodeToScope.get(node);
        // JSM scope check?
        if (scope.upper)
          return;

        if ((node.type === "VariableDeclarator") &&
            (driver.getNodeName(node.id) === "EXPORTED_SYMBOLS") &&
            (node.init.type === "ArrayExpression")) {
          this.mozillaDriver.asyncQueue.push(async () =>
            await this.handleExportedSymbols(node.init.elements, scope)
          );
        }
        else if ((node.type === "AssignmentExpression") &&
                 (driver.getNodeName(node.left) === "EXPORTED_SYMBOLS") &&
                 (node.right.type === "ArrayExpression")) {
          this.mozillaDriver.asyncQueue.push(async () => {
            await this.handleExportedSymbols(node.right.elements, scope);
          });
        }
      }
    };
  }

  async handleExportedSymbols(exported, scope) {
    const names = exported.map(n => this.getNodeName(n));
    for (let i = 0; i < names.length; i++) {
      const name = JSON.parse(names[i]);
      await this.mozillaDriver.findXPCOMComponents(name, scope);
    }
  }

  QueryInterfaceListener() {
    return {
      enter: (node) => {
        if ((node.type === "Property") && (this.getNodeName(node) === "QueryInterface")) {
          let ctorNode = this.getConstructorFunction(this.prototypeStack[0]);
          if (!ctorNode)
            return;
          throw new Error("Not yet implemented");
        }
      },
    }
  }
}


module.exports = MozillaDriver;
