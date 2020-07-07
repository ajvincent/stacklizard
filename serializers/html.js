"use strict";

function HTMLSerializer(root, asyncRefs, parseDriver, options = {}) {
  this.root = root;
  this.asyncRefs = asyncRefs;
  this.parseDriver = parseDriver;
  this.indentBlock = options.nested ? "  " : "";
  this.options = options;

  this.scheduledNodes = new WeakSet();

  this.asyncSyntaxErrors = new Set();
}

HTMLSerializer.prototype.serialize = function()
{
  return `<html>
  <head>
    <base href="https://searchfox.org/mozilla-central/source/"
          target="_blank"
         >
    <meta charset="UTF-8">
  </head>
  <body>
  ${this.appendNodes(null)}
  ${this.appendIgnoredNodes()}
  ${this.appendAsyncSyntaxErrors()}
</body></html>`;
};

HTMLSerializer.prototype.appendNodes = function(key)
{
  const childData = this.asyncRefs.get(key);
  let rv = "<ul>\n";

  let children = [];

  for (let i = 0; i < childData.length; i++) {
    if (this.scheduledNodes.has(childData[i]))
      continue;
    this.scheduledNodes.add(childData[i]);
    children.push(childData[i]);
  }

  for (let i = 0; i < children.length; i++)
    rv += this.serializeChildData(children[i]);

  rv += "</ul>\n"
  return rv;
};

HTMLSerializer.prototype.serializeChildData = function(
  {awaitNode, asyncNode}
)
{
  const asyncName = (asyncNode && this.parseDriver.getNodeName(asyncNode)) ||
                    (awaitNode && this.parseDriver.getNodeName(awaitNode)) ||
                    "";

  let rv = `<li>${asyncName}()`;
  if (awaitNode)
    rv += `, await <a href="${awaitNode.file}#${awaitNode.line}">${this.parseDriver.serializeNode(awaitNode)}</a>`;
  if (asyncNode) {
    rv += `, async <a href="${asyncNode.file}#${asyncNode.line}">${this.parseDriver.serializeNode(asyncNode)}</a>`;

    if (this.parseDriver.isAsyncSyntaxError(asyncNode))
      this.asyncSyntaxErrors.add(asyncNode);
  }

  rv += "\n";

  if (asyncNode && this.asyncRefs.has(asyncNode)) {
    try {
      rv += this.appendNodes(asyncNode);
    }
    catch (ex) {
      console.error(this.parseDriver.fileAndLine(asyncNode));
      throw ex;
    }
  }

  rv += "</li>\n";
  return rv;
};

HTMLSerializer.prototype.appendIgnoredNodes = function() {
  let rv = "<ul>\n";
  this.parseDriver.ignoredNodes.forEach(n => {
    rv += `<li>Ignored: <a href="${n.file}#${n.line}">${this.parseDriver.serializeNode(n)}</a></li>\n`;
  });
  rv += "</ul>\n"
  return rv;
};

HTMLSerializer.prototype.appendAsyncSyntaxErrors = function() {
  let rv = "<ul>\n";
  this.asyncSyntaxErrors.forEach(n => {
    rv += `<li>**SyntaxError**: async <a href="${n.file}#${n.line}">${this.parseDriver.serializeNode(n)}</a></li>\n`;
  });
  rv += "</ul>\n";
  return rv;
};

HTMLSerializer.prototype.getConfiguration = function() {
  return {
    type: "html",
    options: this.options
  };
};

module.exports = HTMLSerializer;
