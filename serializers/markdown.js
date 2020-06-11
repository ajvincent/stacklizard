"use strict";

function MarkdownSerializer(root, asyncRefs, jsDriver, options = {}) {
  this.root = root;
  this.asyncRefs = asyncRefs;
  this.jsDriver = jsDriver;
  this.indentBlock = options.nested ? "  " : "";

  this.scheduledNodes = new WeakSet();
}

MarkdownSerializer.prototype.serialize = function()
{
  return this.appendNodes("", null) + this.appendIgnoredNodes();
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
  const asyncName = (asyncNode && this.jsDriver.getNodeName(asyncNode)) ||
                    (awaitNode && this.jsDriver.getNodeName(awaitNode)) ||
                    "";

  let rv = `${indent}- ${asyncName}()`;
  if (awaitNode)
    rv += `, await ${this.serializeNode(awaitNode)}`;
  if (asyncNode) {
    rv += `, async ${this.serializeNode(asyncNode)}`;
    if (this.jsDriver.accessorNodes.has(asyncNode)) {
      rv += ", accessor";
    }
    if (this.jsDriver.constructorFunctions.has(asyncNode)) {
      rv += ", constructor";
    }
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
  this.jsDriver.ignoredNodes.forEach(n => {
    rv += "- Ignored: " + this.serializeNode(n) + "\n";
  });
  return rv;
};

MarkdownSerializer.prototype.serializeNode = function(node)
{
  return `${this.jsDriver.fileAndLine(node)} ${node.type}[${this.jsDriver.indexOfNodeOnLine(node)}]`;
}

module.exports = function(root, asyncRefs, jsDriver, options)
{
  const serializer = new MarkdownSerializer(
    root,
    asyncRefs,
    jsDriver,
    options
  );
  return serializer.serialize();
};
