"use strict";

/* This is its own file because there are so many combinations that work.
   It's better to keep it on its own.
*/
function AncestorWalker(mozillaDriver, jsDriver, currentScope) {
  this.mozillaDriver = mozillaDriver;
  this.jsDriver = jsDriver;
  this.currentScope = currentScope;
}

AncestorWalker.prototype = {
  find(awaitLocation) {
    let node = this.jsDriver.nodeByLineFilterIndex(
      awaitLocation.path,
      awaitLocation.line,
      0,
      n => n.type === "Literal"
    );

    this.nodeStack = [];
    while (node) {
      this.nodeStack.unshift(node);
      console.log(this.jsDriver.serializeNode(node));

      if (this.handleChromeUtils(node) ||
          this.handleXPCOMUtils(node) ||
          false) {
        return;
      }

      node = this.jsDriver.nodeToParent.get(node);
    }

    console.log("");
    throw new Error("unsupported");
  },

  handleChromeUtils(head) {
    if ((head.type !== "VariableDeclarator") ||
        (head.init.type !== "CallExpression") ||
        (head.init.callee.type !== "MemberExpression") ||
        (head.init.callee.object.type !== "Identifier") ||
        (this.jsDriver.getNodeName(head.init.callee.object) !== "ChromeUtils") ||
        (head.init.callee.property.type !== "Identifier"))
      return false;

    if (head.id.type !== "ObjectPattern")
      throw new Error("unsupported");

    if (this.jsDriver.getNodeName(head.init.callee.property) !== "import")
      throw new Error("unsupported");

    return head.id.properties.every(property => this.assignReference(property));
  },

  handleXPCOMUtils(head) {
    if ((head.type !== "CallExpression") ||
        (head.callee.type !== "MemberExpression") ||
        (head.callee.object.type !== "Identifier") ||
        (this.jsDriver.getNodeName(head.callee.object) !== "XPCOMUtils") ||
        (head.callee.property.type !== "Identifier"))
      return false;

    if (this.jsDriver.getNodeName(head.callee.property) === "defineLazyModuleGetters") {
      const assignee = head.arguments[0];
      if (assignee.type !== "ThisExpression")
        throw new Error("unsupported");
      const properties = head.arguments[1];
      if (properties.type !== "ObjectExpression")
        throw new Error("unsupported");
      this.assignReference(this.nodeStack[this.nodeStack.length - 2].key);
    }
    else {
      throw new Error("unsupported");
    }

    return true;
  },

  assignReference(targetNode) {
    debugger;

    const name = this.jsDriver.getNodeName(targetNode);
    const variable = this.currentScope.set.get(name);
    const sourceNode = variable.defs[0].node;

    // definition is the exported node.  targetNode is where that export is imported.

    this.mozillaDriver.markExportLocation(sourceNode, targetNode);
    return true;
  }
};

function findJSMReferences(mozillaDriver, awaitLocation, jsDriver, currentScope) {
  const walker = new AncestorWalker(mozillaDriver, jsDriver, currentScope);
  walker.find(awaitLocation);
}

module.exports = findJSMReferences;
