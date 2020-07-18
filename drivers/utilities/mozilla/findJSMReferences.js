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

    let nodeStack = [];
    while (node) {
      nodeStack.unshift(node);
      console.log(this.jsDriver.serializeNode(node));

      if (this.handleVariableDeclarator(nodeStack)) {
        return;
      }

      node = this.jsDriver.nodeToParent.get(node);
    }

    console.log("");
    throw new Error("unsupported");
  },

  handleVariableDeclarator(nodeStack) {
    const head = nodeStack[0];
    if (head.type !== "VariableDeclarator")
      return false;

    if (head.id.type !== "ObjectPattern")
      throw new Error("unsupported");

    return this.assignReference(head.id, head.value);
  },

  assignReference(targetNode, sourceNode) {
    const variable = this.currentScope.set.get(this.jsDriver.getNodeName(sourceNode));
    const definition = variable.defs[0];

    void(definition);
    void(targetNode);
    return true;
  }
};

function findJSMReferences(mozillaDriver, awaitLocation, jsDriver, currentScope) {
  const walker = new AncestorWalker(mozillaDriver, jsDriver, currentScope);
  walker.find(awaitLocation);
}

module.exports = findJSMReferences;
