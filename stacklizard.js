"use strict";

/**
 * @fileoverview
 *
 * This code works by traversing the nodes of abstract syntax trees ESPree
 * generates.
 *
 * When we refer to "nodes" in this file, these are nodes from ESPree,
 * not DOM nodes.
 *
 * Generally speaking, for each JavaScript:
 *   - Parse it from ESPree. (parseJSFile)
 *   - Collect the ancestors of each node once through acorn-walk.
 *     (populateMaps)
 *   - Request to mark one function node asynchronous.  Iterate over all nodes
 *     that indirectly impacts to see where async and await keywords would need
 *     to be inserted.  (getStacksOfFunction)
 *   - Serialize the results into a human-readable form.  (serializeAnalysis)
 *
 * How it works:
 * For each function node that we mark async, we walk a reasonable parent
 * node's descendants looking for any callers of that function.  Each such
 * caller is then marked await.  We then have to look for a function node which
 * is an ancestor of that await node and mark that ancestor async.  This means
 * we add it to a set of async nodes to iterate over later.
 */
const espree = require("espree");
const fs = require("fs").promises;
const path = require("path");
const acornWalk = require("acorn-walk");

/**
 * @private
 */
const sourceOptions = {
  loc: true,
  ecmaVersion: 2020,
};

/**
 * @private
 */
const SYMBOLS = {
  abortAcornWalk: Symbol("Abort acorn walk"),
};

/**
 * The StackLizard tool itself.
 * @param {string} rootDir A root directory for all processing.
 * @param {Object} options Configuration options:
 *   (none defined yet)
 *
 * @constructor
 */
function StackLizard(rootDir, options = {}) {
  this.rootDir = rootDir;
  this.options = options;

  /**
   * The cached AST's from Espree.
   * @private
   */
  this.sources = new Map(/*
    path: espree.parse(...)
  */);

  /**
   * A list of ancestor nodes gathered from acorn-walk.
   * @private
   */
  this.ancestorMap = new WeakMap(/* node: node[] */);

  /**
   * Nodes generated against the line number they came from.
   * @private
   */
  this.nodesByLine = new Map(/*
    pathToFile + ":" + lineNumber: node[]
  */);

  /**
   * What file a node came from.
   * @private
   */
  this.nodeToFileName = new WeakMap(/*
    node: pathToFile
  */);

  /**
   * Probable constructors defined by name.
   * @private
   */
  this.constructorNodesByName = new Map(/*
    name: node[]
  */);

  /**
   * Probable instances of a constructor defined by name.
   * @private
   */
  this.instanceNodes = new Map(/*
    name: node[]
  */);

  /**
   * Nodes which represent constructors.
   * @private
   */
  this.constructorNodesSet = new WeakSet(/* node, ... */);
}

StackLizard.prototype = {
  /**
   * Read a JS file from the filesystem.
   * @param {string} pathToFile The relative path to the file.
   *
   * @returns An AST from ESPree.parse().
   * @public
   */
  parseJSFile: async function(pathToFile) {
    if (this.sources.has(pathToFile))
      return this.sources.get(pathToFile);

    const fullPath = path.join(process.cwd(), this.rootDir, pathToFile);
    const source = await fs.readFile(fullPath, { encoding: "UTF-8"} );
    const ast = espree.parse(source, sourceOptions);
    this.sources.set(pathToFile, ast);
    return ast;
  },

  /**
   * Walk a syntax tree once to gather information into various hashtables.
   *
   * @param {string|Symbol} pathToFile  The key the AST was stored in.
   * @param {Object}        corrections Metadata indicating fixes to make
   *                                    across the tree.
   *   (not yet supported)
   *
   * @public
   */
  populateMaps: function(pathToFile, corrections = {}) {
    const ast = this.sources.get(pathToFile);
    // Warning:  this is a post-order search, not pre-order as you might expect.
    acornWalk.fullAncestor(
      ast,
      (node, ancestors) => {
        // Apply corrections.

        // Cache the ancestors.
        ancestors = ancestors.slice(0);
        ancestors.reverse();
        this.ancestorMap.set(node, ancestors);

        // Each node has its place on a line.
        const lineNumber = node.loc.start.line;
        const key = pathToFile + ":" + lineNumber;
        if (!this.nodesByLine.has(key))
          this.nodesByLine.set(key, []);
        this.nodesByLine.get(key).unshift(node);

        // We know which file each node came from.
        this.nodeToFileName.set(node, pathToFile);

        // Constructors and instances of constructors.
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

  /**
   * Find a particular FunctionExpression node from a given file and line.
   * @param {string} pathToFile    The relative file path.
   * @param {number} lineNumber    The line number in the file.
   * @param {number} functionIndex The index of the function on the line.
   *
   * @note functionIndex isn't as unreasonable as it may sound.  It's common to
   *       have lambda functions on the same line as a parent function.
   *
   * @private
   */
  functionNodeFromLine: function(pathToFile, lineNumber, functionIndex = 0) {
    const key = pathToFile + ":" + lineNumber;
    let nodeList = this.nodesByLine.get(key);
    nodeList = nodeList.filter((node) => node.type === "FunctionExpression");
    return nodeList[functionIndex] || null;
  },

  /**
   * Gather metadata about what objects a particular node is a member of.
   *
   * @param {Node[]} ancestors  The ancestor chain of node, from that node to the root.
   * @private
   *
   * @returns {Object}
   */
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

  /**
   * Extract a list of synchronous function nodes referencing an asynchronous function.
   *
   * @param {string} parentPath    The parent name to look for (currently only "this" supported)
   * @param {string} propertyType  The type of the property from ESPree.  Usually "init" for methods.
   * @param {string} methodName    The name of the property we're trying to match.
   * @param {Node}   haystackNode  The root of the search.  (Think Class.prototype.)
   * @param {Node}   needleNode    The asynchronous node (as a reference).
   *
   * @returns {Node[]} A list of nodes which must be marked await.
   * @private
   */
  nodesCallingMethodSync: function(
    parentPath,
    propertyType,
    methodName,
    haystackNode,
    needleNode
  )
  {
    // Warning:  this is a post-order search, not pre-order as you might expect.
    // ESPree is driving the search, so we can't do anything about that here.

    // Define the callbacks for acorn-walk.
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

    // Actually walk down from a set of nodes that might reference the method.
    /* valueNodes is a bad name.  This is all about determining the list of
       nodes we have to search for references to the async function.
    */
    const isFunctionDecl = haystackNode && (haystackNode.type === "FunctionDeclaration");
    let valueNodes;
    // normal case:  the needleNode is the property of an object being assigned a name.
    if (haystackNode && (haystackNode.type === "ObjectExpression"))
      valueNodes = haystackNode.properties.map((n) => n.value);

    // instances of a constructor.
    else if (this.constructorNodesSet.has(needleNode)) {
      valueNodes = this.instanceNodes.get(needleNode.id.name);
    }

    // Top-level functions, often constructors.
    else if (isFunctionDecl)
      valueNodes = [haystackNode.body];
    else
      throw new Error(`Unknown haystackNode type: ${haystackNode.type} for line ${haystackNode.loc.start.line}`);

    const awaitNodes = [/* node ... */ ];
    // XXX ajvincent this should be valueNodes.forEach().
    valueNodes.filter((subNode) => {
      // XXX ajvincent This might be a bug, for recursive functions.
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

  /**
   * Mark a node asynchronous, and generate stack traces which indicate other
   * nodes to mark async and await.
   *
   * @param {*} pathToFile
   * @param {*} lineNumber
   * @param {*} functionIndex
   *
   * @returns {Object} A dictionary:
   *   - matchedNodes {Node[]} A list of async-marked nodes.
   *   - awaitNodeMap {WeakMap(Node: Node[])}
   *                           From async nodes to calling await nodes.
   *
   * @public
   */
  getStacksOfFunction: function(pathToFile, lineNumber, functionIndex = 0) {
    const functionNode = this.functionNodeFromLine(
      pathToFile, lineNumber, functionIndex
    );

    // @return
    let matchedNodes = [functionNode];

    const visitedNodes = new WeakSet(/* node, ... */);

    // @return
    const awaitNodeMap = new WeakMap(/* node: node[] */);

    for (let i = 0; i < matchedNodes.length; i++) {
      const currentNode = matchedNodes[i];
      const ancestors = this.ancestorMap.get(currentNode);
      const propData = this.definedOn(ancestors);

      // Ordinary methods, getters and setters
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

      // Look for more nodes to mark async and add to our search space.
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

  /**
   * Find a constructor node associated with a possible prototype.
   * @param {Node[]} ancestors The list of ancestors for our source node.
   *
   * @returns {Node?} The constructor node we identified, if we can.
   * @private
   */
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

  /**
   * Generate a string representation of newly-marked async and await nodes.
   * @param {Object} stackData from getStacksOfFunction()
   *
   * @returns {string} The serialization in Markdown format.
   * @public
   */
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

  /**
   * Serialize a function node we haven't seen in serializing before.
   * @param {Node} currentNode
   * @param {WeakSet} visitedNodes
   * @param {WeakMap} awaitNodeMap Await nodes mapped to their calling async nodes.
   *
   * @returns {string} The serialization in Markdown format.
   * @private
   * @see getStacksOfFunction() for awaitNodeMap.
   */
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

    // Recursive search.
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

  /**
   * Serialize a newly-marked await node.
   * @param {string} prefix  Spaces for indentation.
   * @param {*} awaitNode
   * @param {*} visitedNodes 
   * @param {*} awaitNodeMap
   *
   * @returns {string} The serialization in Markdown format.
   * @private
   * @see getStacksOfFunction() for awaitNodeMap.
   */
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

    // Recursive search.
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

  /**
   * Attempt to get the full name of a property reference.
   * @param {Node[]} ancestors The list of ancestors for our source node.
   *
   * @returns {string}
   * @private
   */
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
