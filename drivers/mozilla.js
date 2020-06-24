"use strict";

/*
const fs = require("fs").promises;
*/
const path = require("path");

/*
function voidFunc() {}
*/

const JSDriver = require("./javascript");
const XPCOMClassesData = require("./utilities/mozilla/xpcom-classes");

class MozillaJSDriver extends JSDriver {
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
    return {
      async enter(node) {
        let scope = this.nodeToScope.get(node);
        // JSM scope check?
        if (scope.upper)
          return;

        if ((node.type === "VariableDeclarator") &&
            (this.getNodeName(node.id) === "EXPORTED_SYMBOLS") &&
            (node.init.type === "ArrayExpression")) {
          await this.handleExportedSymbols(node.init.elements, scope);
        }
        else if ((node.type === "AssignmentExpression") &&
                 (this.getNodeName(node.left) === "EXPORTED_SYMBOLS") &&
                 (node.right.type === "ArrayExpression")) {
          await this.handleExportedSymbols(node.right.elements, scope);
        }
      }
    };
  }

  /*
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
  */
}

class MozillaDriver {
  constructor(rootDir, objdir, options = {}) {
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
    this.fullObjDir = path.resolve(this.cwd, objdir);

    this.ctorNameToContractIDs = new Map(/*
      constructor name: [ contract id, ... ]
    */);

    this.xpcomComponents = new WeakSet(/*
      AST node, ...
    */);
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

  async gatherXPTData() {
    // objdir/config/makefiles/xpidl/*.xpt
    throw new Error("Not yet implemented");
  }

  async handleExportedSymbols(exported, scope) {
    exported.map(n => this.getNodeName(n)).forEach(name => this.findXPCOMComponents(name, scope));
  }

  async findXPCOMComponents(name, scope) {
    const contractIds = this.ctorNameToContractIDs.get(name);
    if (!contractIds) {
      return;
    }

    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    this.xpcomComponents.add(definition.node);

    /* XXX to-do:
    Match contract ID's to additional scopes
    Match IDL files
    Load additional scopes
    */
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

module.exports = MozillaDriver;
