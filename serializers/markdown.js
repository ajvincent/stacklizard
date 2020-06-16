"use strict";

function MarkdownSerializer(root, asyncRefs, parseDriver, options = {}) {
  this.root = root;
  this.asyncRefs = asyncRefs;
  this.parseDriver = parseDriver;
  this.indentBlock = options.nested ? "  " : "";
  this.options = options;

  this.scheduledNodes = new WeakSet();

  this.asyncSyntaxErrors = new Set();
}

MarkdownSerializer.prototype.serialize = function()
{
  return this.appendNodes("", null) + this.appendIgnoredNodes() + this.appendAsyncSyntaxErrors();
};

MarkdownSerializer.prototype.appendNodes = function(indent, key)
{
  const childData = this.asyncRefs.get(key);
  let rv = "";

  let children = [];

  for (let i = 0; i < childData.length; i++) {
    if (this.scheduledNodes.has(childData[i]))
      continue;
    this.scheduledNodes.add(childData[i]);
    children.push(childData[i]);
  }

  for (let i = 0; i < children.length; i++)
    rv += this.serializeChildData(indent, children[i]);

  return rv;
};

MarkdownSerializer.prototype.serializeChildData = function(
  indent,
  {awaitNode, asyncNode}
)
{
  const asyncName = (asyncNode && this.parseDriver.getNodeName(asyncNode)) ||
                    (awaitNode && this.parseDriver.getNodeName(awaitNode)) ||
                    "";

  let rv = `${indent}- ${asyncName}()`;
  if (awaitNode)
    rv += `, await ${this.parseDriver.serializeNode(awaitNode)}`;
  if (asyncNode) {
    rv += `, async ${this.parseDriver.serializeNode(asyncNode)}`;

    if (this.parseDriver.isAsyncSyntaxError(asyncNode))
      this.asyncSyntaxErrors.add(asyncNode);
  }

  rv += "\n";

  if (asyncNode && this.asyncRefs.has(asyncNode)) {
    try {
      rv += this.appendNodes(indent + this.indentBlock, asyncNode);
    }
    catch (ex) {
      console.error(this.parseDriver.fileAndLine(asyncNode));
      throw ex;
    }
  }

  return rv;
};

MarkdownSerializer.prototype.appendIgnoredNodes = function() {
  let rv = "";
  this.parseDriver.ignoredNodes.forEach(n => {
    rv += "- Ignored: " + this.parseDriver.serializeNode(n) + "\n";
  });
  return rv;
};

MarkdownSerializer.prototype.appendAsyncSyntaxErrors = function() {
  let rv = "";
  this.asyncSyntaxErrors.forEach(n => {
    rv += "- **SyntaxError**: async " + this.parseDriver.serializeNode(n) + "\n";
  });
  return rv;
};

MarkdownSerializer.prototype.getConfiguration = function() {
  return {
    type: "markdown",
    options: this.options
  };
};

module.exports = MarkdownSerializer;
