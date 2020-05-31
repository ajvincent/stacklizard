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

  this.nodeToFileName = new WeakMap(/*
    node: pathToFile
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

        this.nodeToFileName.set(node, pathToFile);
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
    let earliestMatch = null;

    if ((propertyType === "init") ||
        (propertyType === "get")) {
      if (parentPath !== "this")
        throw new Error("Not yet supporting non-this parents");

      walkVisitors.CallExpression = (descendantNode) => {
        if (earliestMatch ||
            (descendantNode.callee.object.type !== "ThisExpression") ||
            (descendantNode.callee.property.name !== methodName))
          return;
        earliestMatch = descendantNode;
      };

      walkVisitors.AwaitExpression = (descendantNode) => {
        if (earliestMatch === descendantNode.argument)
          earliestMatch = null;
      };
    }
    else {
      throw new Error(`Unsupported property type: ${propertyType}`);
    }

    if (propertyType === "get") {
      walkVisitors.MemberExpression = (descendantNode) => {
        if (earliestMatch ||
            (descendantNode.object.type !== "ThisExpression") ||
            (descendantNode.property.name !== methodName))
          return;
        earliestMatch = descendantNode;
      };
    }

    const valueNodes = haystackNode.properties.map((n) => n.value);

    const awaitNodes = [/* node ... */ ];
    valueNodes.filter((subNode) => {
      if (subNode === needleNode)
        return false;
      if (subNode.type !== "FunctionExpression")
        return false;

      earliestMatch = null;
      acornWalk.simple(subNode.body, walkVisitors);

      if (earliestMatch) {
        awaitNodes.push(earliestMatch);
      }

      return earliestMatch;
    });

    return awaitNodes;
  },

  getStacksOfFunction: function(pathToFile, lineNumber, functionIndex = 0) {
    const functionNode = this.functionNodeFromLine(
      pathToFile, lineNumber, functionIndex
    );
    let matchedNodes = [functionNode];

    const visitedNodes = new WeakSet(/* node, ... */);
    const awaitNodeMap = new WeakMap(/* node: node[] */);

    for (let i = 0; i < matchedNodes.length; i++) {
      const currentNode = matchedNodes[i];
      const ancestors = this.ancestorMap.get(currentNode);
      const propData = this.definedOn(ancestors);
      const awaitNodes = this.nodesCallingMethodSync(
        "this",
        ancestors[1].kind,
        propData.name,
        propData.directParentNode,
        propData.node,
        ""
      );

      awaitNodeMap.set(currentNode, awaitNodes.slice(0));

      awaitNodes.forEach((awaitNode) => {
        const ancestors = this.ancestorMap.get(awaitNode);
        const node = ancestors.find(n => n.type === "FunctionExpression");

        if (visitedNodes.has(node))
          return;
        visitedNodes.add(node);
        matchedNodes.push(node);
      });
    }

    return {
      matchedNodes,
      awaitNodeMap
    };
  },

  serializeAnalysis: function(stackData) {
    const visitedNodes = new WeakSet();
    let results = "";
    for (let i = 0; i < stackData.matchedNodes.length; i++) {
      const currentNode = stackData.matchedNodes[i];
      if (visitedNodes.has(currentNode))
        continue;
      results += this.serializeSyncLeafNode(
        currentNode, visitedNodes, stackData.awaitNodeMap
      );
    }
    return results;
  },

  serializeSyncLeafNode: function(
    currentNode,
    visitedNodes,
    awaitNodeMap,
  )
  {
    let results = "";
    visitedNodes.add(currentNode);

    {
      const ancestors = this.ancestorMap.get(currentNode);
      results += ancestors[1].key.name + "()";
    }

    {
      const fileLine = this.nodeToFileName.get(currentNode);
      results += ", " + fileLine;
    }
    results += `: async ${currentNode.loc.start.line}\n`;

    const awaitNodes = awaitNodeMap.get(currentNode);
    awaitNodes.forEach((awaitNode) => {
      results += this.serializeSyncAwaitNode(
        "  ",
        awaitNode,
        visitedNodes,
        awaitNodeMap
      );
    });

    return results;
  },

  serializeSyncAwaitNode: function(
    prefix,
    awaitNode,
    visitedNodes,
    awaitNodeMap
  )
  {
    const ancestors = this.ancestorMap.get(awaitNode);
    const asyncIndex = ancestors.findIndex(n => n.type === "FunctionExpression");
    const asyncNode = ancestors[asyncIndex];
    visitedNodes.add(asyncNode);

    const name = ancestors[asyncIndex + 1].key.name;
    var results = `${prefix}${name}()`;

    {
      const fileLine = this.nodeToFileName.get(awaitNode);
      results += ", " + fileLine;
    }
    results += ": ";

    if (!asyncNode.async) {
      results += `async ${asyncNode.loc.start.line}, `;
    }

    results += `await ${awaitNode.loc.start.line}\n`;

    const nextAwaitNodes = awaitNodeMap.get(asyncNode);
    nextAwaitNodes.forEach((nextAwaitNode) => {
      results += this.serializeSyncAwaitNode(
        prefix + "  ",
        nextAwaitNode,
        visitedNodes,
        awaitNodeMap
      );
    });

    return results;
  }
};

module.exports = StackLizard;
