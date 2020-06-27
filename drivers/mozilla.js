"use strict";

/*
const fs = require("fs").promises;
*/
const path = require("path");
const JSDriver = require("./javascript");
const XPCOMClassesData = require("./utilities/mozilla/xpcom-classes");

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
  }

  async analyzeByConfiguration(config, options) {
    if (config.type === "javascript")
      return this.analyzeByJSConfiguration(config, options);
    throw new Error("Unsupported configuration type");
  }

  async analyzeByJSConfiguration(config, options) {
    this.startingMarkAsync = config.markAsync;

    this.scheduledConfigs = [config];
    for (let i = 0; i < this.scheduledConfigs.length; i++) {
      const currentConfig = this.scheduledConfigs[i];
      if (!this.sourceToDriver.has(currentConfig.markAsync.path)) {
        await this.buildSubDriver(currentConfig, options);
      }

      const subDriver = this.sourceToDriver.get(currentConfig.markAsync.path);
      await subDriver.analyzeByConfiguration(currentConfig);
    }
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
      if (!("constructor" in item) ||
          !("contract_ids" in item))
        return;
      if (this.ctorNameToContractIDs.has(item.constructor))
        throw new Error("Overloaded name: " + item.constructor);
      this.ctorNameToContractIDs.set(
        item.constructor,
        item.contract_ids
      );
    });
  }

  async findXPCOMComponents(name, scope) {
    const contractIds = this.ctorNameToContractIDs.get(name);
    if (!contractIds) {
      return;
    }

    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    this.xpcomComponents.add(definition.node);

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

  /*
  serializeNode(node) {
    let rv = JSDriver.prototype.serializeNode.call(this, node);
    if (this.xpcomComponents.has(node))
      rv += ", XPCOM component";
    return rv;
  }
  */
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
    traverseListeners.append(this.exportedSymbolsListener());
  }

  exportedSymbolsListener() {
    const driver = this;
    return {
      async enter(node) {
        let scope = driver.nodeToScope.get(node);
        // JSM scope check?
        if (scope.upper)
          return;

        if ((node.type === "VariableDeclarator") &&
            (driver.getNodeName(node.id) === "EXPORTED_SYMBOLS") &&
            (node.init.type === "ArrayExpression")) {
          await driver.handleExportedSymbols(node.init.elements, scope);
        }
        else if ((node.type === "AssignmentExpression") &&
                 (driver.getNodeName(node.left) === "EXPORTED_SYMBOLS") &&
                 (node.right.type === "ArrayExpression")) {
          await driver.handleExportedSymbols(node.right.elements, scope);
        }
      }
    };
  }

  async handleExportedSymbols(exported, scope) {
    exported.map(n => JSON.parse(this.getNodeName(n))).forEach(
      name => this.mozillaDriver.findXPCOMComponents(name, scope)
    );
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
