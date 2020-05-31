"use strict";
const espree = require("espree");
const fs = require("fs").promises;
const path = require("path");
const acornWalk = require("acorn-walk");

const sourceOptions = {
  loc: true,
  ecmaVersion: 2020,
};

const SYMBOLS = {
  abortAcornWalk: Symbol("Abort acorn walk"),
};

function StackLizard(rootDir, options = {}) {
  this.rootDir = rootDir;
  this.options = options;
  this.sources = new Map(/*
    path: espree.parse(...)
  */);
  this.ancestorMap = new WeakMap(/* node: node[] */);
  this.nodesByLine = new Map(/*
    pathToFile + ":" + lineNumber: node[]
  */);

  this.linesByNode = new WeakMap(/*
    node: pathToFile + ":" + lineNumber
  */);
}
StackLizard.prototype = {
  parseJSFile: async function(pathToFile) {
    if (this.sources.has(pathToFile))
      return this.sources.get(pathToFile);

    const fullPath = path.join(process.cwd(), this.rootDir, pathToFile);
    const source = await fs.readFile(fullPath, { encoding: "UTF-8"} );
    const ast = espree.parse(source, sourceOptions);
    this.sources.set(pathToFile, ast);

    // map nodes to ancestors, and record each node by its starting line number.
    acornWalk.fullAncestor(
      ast,
      (node, ancestors) => {
        ancestors = ancestors.slice(0);
        ancestors.reverse();
        this.ancestorMap.set(node, ancestors);

        const lineNumber = node.loc.start.line;
        const key = pathToFile + ":" + lineNumber;
        if (!this.nodesByLine.has(key))
          this.nodesByLine.set(key, []);
        this.nodesByLine.get(key).unshift(node);

        this.linesByNode.set(node, key);
      }
    );

    return ast;
  },

  functionNodeFromLine: function(pathToFile, lineNumber, functionIndex = 0) {
    const key = pathToFile + ":" + lineNumber;
    let nodeList = this.nodesByLine.get(key);
    nodeList = nodeList.filter((node) => node.type === "FunctionExpression");
    return nodeList[functionIndex] || null;
  },

  definedOn: function(ancestors) {
    ancestors = ancestors.slice();

    let rv = {
      node: ancestors.shift(),
      name: "",
      directParentNode: null,
      directParentName: "",
      ctorParentName: "",
    }

    // What name is the function assigned to?
    {
      let node = ancestors.shift();

      if (node.type === "Property") {
        rv.name = node.key.name;
      }
      else {
        throw new Error("Unknown name for the desired function");
      }
    }

    // What object holds this function as a method?
    {
      let node = ancestors.shift();
      if (node.type === "ObjectExpression") {
        rv.directParentNode = node;
      }
      else {
        throw new Error(`Unknown parent object for the desired method ${rv.name}`);
      }
    }

    // What name received the parent object?
    {
      let node = ancestors.shift();
      if (node.type === "AssignmentExpression") {
        // ignore the right, we just processed that
        if (node.left.type === "MemberExpression") {
          if (node.left.property.name === "prototype") {
            // Aha, it's used in a constructor as well
            rv.ctorParentName = node.left.object.name;
          }
          rv.directParentName = `${node.left.object.name}.${node.left.property.name}`;
        }
        else {
          throw new Error(`Unknown assignee for the parent object of ${rv.name} at line ${node.loc.start}, column ${node.loc.start.column}`);
        }
      }
      else {
        throw new Error(`Unknown target for the parent object of ${rv.name}`);
      }
    }

    return rv;
  },

  nodesCallingMethodSync: function(
    parentPath,
    propertyType,
    methodName,
    haystackNode,
    needleNode
  )
  {
    const walkVisitors = {};
    let lastMatched = null;

    if ((propertyType === "init") ||
        (propertyType === "get")) {
      if (parentPath !== "this")
        throw new Error("Not yet supporting non-this parents");

      walkVisitors.CallExpression = (descendantNode) => {
        if ((descendantNode.callee.object.type !== "ThisExpression") ||
            (descendantNode.callee.property.name !== methodName))
          return;
        lastMatched = descendantNode;
      };

      walkVisitors.AwaitExpression = (descendantNode) => {
        if (lastMatched === descendantNode.argument)
          lastMatched = null;
      };
    }
    else {
      throw new Error(`Unsupported property type: ${propertyType}`);
    }

    if (propertyType === "get") {
      walkVisitors.MemberExpression = (descendantNode) => {
        if ((descendantNode.object.type !== "ThisExpression") ||
            (descendantNode.property.name !== methodName))
          return;
        lastMatched = descendantNode;
      };
    }

    const valueNodes = haystackNode.properties.map((n) => n.value);

    return valueNodes.filter((subNode) => {
      if (subNode === needleNode)
        return false;
      if (subNode.type !== "FunctionExpression")
        return false;

      lastMatched = null;
      acornWalk.simple(subNode.body, walkVisitors);

      let rv = Boolean(lastMatched);
      lastMatched = null;
      return rv;
    });
  },

  getStacksOfFunction: function(pathToFile, lineNumber, functionIndex = 0) {
    const functionNode = this.functionNodeFromLine(
      pathToFile, lineNumber, functionIndex
    );
    let matchedNodes = [functionNode];
    let indentMap = new WeakMap();
    indentMap.set(functionNode, 0);

    for (let i = 0; i < matchedNodes.length; i++) {
      const currentNode = matchedNodes[i];
      const indent = indentMap.get(currentNode) + 1;
      const ancestors = this.ancestorMap.get(currentNode);
      const propData = this.definedOn(ancestors);
      const methodNodes = this.nodesCallingMethodSync(
        "this",
        ancestors[1].kind,
        propData.name,
        propData.directParentNode,
        propData.node,
        ""
      );

      methodNodes.forEach((node) => {
        if (indentMap.has(node))
          return;
        indentMap.set(node, indent);
        matchedNodes.push(node);
      });

      debugger;
    }

    return matchedNodes;
  }
};

module.exports = StackLizard;
