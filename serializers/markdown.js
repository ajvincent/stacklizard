"use strict";

function MarkdownSerializer(root, asyncRefs, parseDriver, options = {}) {
  this.root = root;
  this.asyncRefs = asyncRefs;
  this.parseDriver = parseDriver;
  this.indentBlock = options.nested ? "  " : "";

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

  for (let i = 0; i < childData.length; i++)
    this.scheduledNodes.add(childData[i]);

  for (let i = 0; i < childData.length; i++)
    rv += this.serializeChildData(indent, childData[i]);

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

  if (asyncNode &&
      this.asyncRefs.has(asyncNode) &&
      !this.scheduledNodes.has(asyncNode))
    rv += this.appendNodes(indent + this.indentBlock, asyncNode);

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
}

module.exports = function(root, asyncRefs, parseDriver, options)
{
  const serializer = new MarkdownSerializer(
    root,
    asyncRefs,
    parseDriver,
    options
  );
  return serializer.serialize();
};
