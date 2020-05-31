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

  this.constructorNodesByName = new Map(/*
    name: node[]
  */);
  this.instanceNodes = new Map(/*
    name: node[]
  */);
  this.constructorNodesSet = new WeakSet();
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

        if ((node.type === "FunctionDeclaration") &&
            !this.constructorNodesByName.has(node.id.name)) {
          this.constructorNodesByName.set(node.id.name, node);
        }
        else if (node.type === "NewExpression") {
          const ctor = node.callee.name;
          if (!this.instanceNodes.has(ctor))
            this.instanceNodes.set(ctor, []);
          this.instanceNodes.get(ctor).push(node);
        }
      }
    );
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
      else if ((node.type === "Program") && (rv.node.type === "FunctionDeclaration")) {
        rv.name = rv.node.id.name;
        return rv;
      }
      else {
        throw new Error(`Unknown name for the desired function at ${rv.node.loc.start.line}`);
      }
    }

    // What object holds this function as a method?
    {
      let node = ancestors.shift();
      if (node.type === "ObjectExpression") {
        rv.directParentNode = node;
      }
      else {
        throw new Error(`Unknown parent object for the desired method ${rv.name} at ${rv.node.loc.start.line}`);
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
    else if (!this.constructorNodesSet.has(needleNode)) {
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

    const isFunctionDecl = haystackNode && (haystackNode.type === "FunctionDeclaration");
    let valueNodes;
    if (haystackNode && (haystackNode.type === "ObjectExpression"))
      valueNodes = haystackNode.properties.map((n) => n.value);
    else if (this.constructorNodesSet.has(needleNode)) {
      valueNodes = this.instanceNodes.get(needleNode.id.name);
    }
    else if (isFunctionDecl)
      valueNodes = [haystackNode.body];
    else
      throw new Error(`Unknown haystackNode type: ${haystackNode.type} for line ${haystackNode.loc.start.line}`);

    const awaitNodes = [/* node ... */ ];
    valueNodes.filter((subNode) => {
      if (subNode === needleNode)
        return false;

      let root;
      if (isFunctionDecl)
        root = subNode;
      else if (subNode.type === "FunctionExpression")
        root = subNode.body;
      else
        return false;

      earliestMatch = null;
      acornWalk.simple(root, walkVisitors);

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

      let awaitNodes = this.nodesCallingMethodSync(
        "this",
        ancestors[1].kind,
        propData.name,
        propData.directParentNode,
        propData.node,
      );

      // Constructors
      let ctorNode = this.findConstructorNode(ancestors);
      if (ctorNode) {
        let ctorDescendants = this.nodesCallingMethodSync(
          "this",
          ancestors[1].kind,
          propData.name,
          ctorNode,
          propData.node
        );
        if (ctorDescendants.length) {
          this.constructorNodesSet.add(ctorNode);
          awaitNodes = awaitNodes.concat(ctorDescendants);
        }
      }

      // Instances
      if (this.constructorNodesSet.has(currentNode)) {
        const ctorName = currentNode.id.name;
        awaitNodes = awaitNodes.concat(this.instanceNodes.get(ctorName));
      }

      awaitNodeMap.set(currentNode, awaitNodes.slice(0));

      awaitNodes.forEach((awaitNode) => {
        const ancestors = this.ancestorMap.get(awaitNode);
        const node = ancestors.find(n => n.type.includes("Function"));

        if (!node || visitedNodes.has(node))
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

  findConstructorNode: function(ancestors) {
    const assignment = ancestors.find(anc => anc.type === "AssignmentExpression");
    if (!assignment)
      return null;
    const propertyName = assignment.left.property.name;
    const leftObj = assignment.left.object;
    let nameWithProto = "";
    if (propertyName === "prototype")
      nameWithProto = this.getFullName(this.ancestorMap.get(leftObj));

    // Maybe prototype appears on the object's name parts.
    else if (leftObj.property.name === "prototype")
      nameWithProto = this.getFullName(this.ancestorMap.get(leftObj.object))

    if (nameWithProto)
      return this.constructorNodesByName.get(nameWithProto.substr(0, nameWithProto.length - 10));
    return null;
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
    let results = "- ";
    visitedNodes.add(currentNode);

    {
      const ancestors = this.ancestorMap.get(currentNode);
      results += this.getFullName(ancestors) + "()";
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
    const asyncIndex = ancestors.findIndex(n => n.type.includes("Function"));
    const asyncNode = ancestors[asyncIndex];
    if (asyncNode)
      visitedNodes.add(asyncNode);

    var results = prefix + "- ";

    {
      let name;
      if (this.constructorNodesSet.has(asyncNode))
        results += asyncNode.id.name;
      else
        results += `${this.getFullName(ancestors)}`;
    }

    if (asyncNode)
      results += "()";

    {
      const fileLine = this.nodeToFileName.get(awaitNode);
      results += ", " + fileLine;
    }
    results += ": ";

    if (asyncNode && !asyncNode.async) {
      results += `async ${asyncNode.loc.start.line}, `;
    }

    results += `await ${awaitNode.loc.start.line}`;

    // Getter and setter annotations
    if (asyncIndex < ancestors.length - 1) {
      let asyncParent = ancestors[asyncIndex + 1];
      if ((asyncParent.type === "Property") && (asyncParent.kind === "get"))
        results += ", getter";

      if ((asyncParent.type === "Property") && (asyncParent.kind === "set"))
        results += ", setter";
    }

    // Instance annotation
    if (awaitNode.type === "NewExpression") {
      results += ", instance";
    }

    results += '\n';

    if (asyncNode) {
      const nextAwaitNodes = awaitNodeMap.get(asyncNode);
      nextAwaitNodes.forEach((nextAwaitNode) => {
        results += this.serializeSyncAwaitNode(
          prefix + "  ",
          nextAwaitNode,
          visitedNodes,
          awaitNodeMap
        );
      });
    }

    return results;
  },

  getFullName: function(ancestors) {
    let rv = "";
    ancestors.forEach(anc => {
      switch (anc.type) {
        case "Property":
          rv = anc.key.name + ".";
          return;

        case "AssignmentExpression":
          let stack = [];
          let obj = anc.left.object;
          while (obj.type === "MemberExpression") {
            stack.unshift(obj);
            obj = obj.object;
          }
          let names = stack.map(mid => mid.property.name);
          names.push(anc.left.property.name);
          names.unshift(obj.name);

          rv = names.join(".") + "." + rv;
          return;

        case "VariableDeclarator":
          rv = anc.id.name + ".";
      }
    });
    return rv.substr(0, rv.length - 1);
  }
};


module.exports = StackLizard;
