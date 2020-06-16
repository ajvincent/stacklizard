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
 *   - Add the script to the driver's buffer. (appendJSFile or appendSource)
 *   - Parse the buffer and collect metadata about AST nodes. (parseSources)
 *   - Get an AST node based on the file and line it came from.
 *     (functionNodeFromLine)
 *   - Iterate over all nodes that indirectly impacts to see where
 *     async and await keywords would need to be inserted.  (getAsyncStacks)
 *
 * How it works:
 * For each function node that we mark async, we look up reasonable callers of
 * that function.  Each such caller is then marked await.  We then have to look
 * for a function node which is an ancestor of that await node and mark that
 * ancestor async.  This means we add it to a set of async nodes to iterate over
 * later.
 *
 * When the JSDriver incorrectly marks a node async or await, you can override
 * it by calling the JSDriver's markIgnored() method with a node you extracted
 * via the driver's nodeByLineFilterIndex() method.  This will force the
 * driver to not walk the stack below that node as well.  Call this before
 * calling getAsyncStacks().
 *
 * Every JavaScript source you pass to JSDriver must be syntactically correct.
 * Garbage in, garbage out.
 *
 * Also, constructors, getters and setters cannot be async.  The JSDriver does
 * not care about this syntax rule, except to call those to the user's
 * attention for refactoring.  The job of JSDriver is simply to report where
 * changes must be made, and what type of changes those must be.
 */

const espree = require("espree");
const eslintScope = require('eslint-scope');
const estraverse = require('estraverse');
const fs = require("fs").promises;
const path = require("path");

/**
 * @private
 */
const sourceOptions = {
  loc: true,
  ecmaVersion: 2020,
  range: true,
};

function voidFunc() {}

/**
 * A stack of enter/leave listeners for estraverse.
 *
 * @private
 */
function MultiplexListeners() {
  this.enter = this.enter.bind(this);
  this.leave = this.leave.bind(this);
  this.clear();
}

MultiplexListeners.prototype.append = function(listener) {
  this.listenersEnter.push(listener.enter || voidFunc);
  this.listenersLeave.unshift(listener.leave || voidFunc);
};

MultiplexListeners.prototype.enter = function(node, parent) {
  this.listenersEnter.forEach(listener => listener(node, parent));
};

MultiplexListeners.prototype.leave = function(node, parent) {
  this.listenersLeave.forEach(listener => listener(node, parent));
};

MultiplexListeners.prototype.clear = function() {
  this.listenersEnter = [];
  this.listenersLeave = [];
};

// helper functions

function isFunctionNode(node) {
  return node.type.includes("Function");
}

// A.prototype = { b: function() { ... } };
function isPrototypeMember(node) {
  return node.type === "MemberExpression" &&
         node.property.type === "Identifier" &&
         node.property.name === "prototype";
}

// this.foo;
function isMemberThis(node) {
  return (node.type === "MemberExpression") &&
         (node.object.type === "ThisExpression");
}

// A.prototype.b = function() { ... };
function isPrototypeAssignMethod(node) {
  if (node.type !== "AssignmentExpression")
    return false;

  if (!isFunctionNode(node.right))
    return false;

  if (node.left.type !== "MemberExpression")
    return false;
  if (node.left.property.type !== "Identifier")
    return false;

  return isPrototypeMember(node.left.object);
}

/**
 * The JavaScript driver.
 * @param {string} rootDir A root directory for all processing.
 * @param {Object} options Configuration options:
 *   (none defined yet)
 *
 * @constructor
 */
function JSDriver(rootDir, options = {}) {
  /**
   * The root directory.
   * @private
   */
  this.rootDir = rootDir;

  /**
   * Configuration options.
   * @private
   */
  this.options = options;

  /**
   * The list of files we've registered.
   * @private
   */
  this.sources = new Set(/* pathToFile */);

  /**
   * The lines to parse.
   * @private
   */
  this.parsingBuffer = [];

  /**
   * How we map a parsingBuffer line to its original source code.
   * @private
   */
  this.lineMapping = [/*
    {
      endSourceLine: integer,
      pathToFile,
      firstLineInFile
    }
  */];

  /**
   * Nodes generated against the line number they came from.
   * @private
   */
  this.nodesByLine = new Map(/*
    pathToFile + ":" + lineNumber: node[]
  */);

  /**
   * A mapping of nodes to the JS scope they live in.
   * @private
   */
  this.nodeToScope = new WeakMap(/*
    node: scope
  */);

  /**
   * Function calls by name.
   * @private
   */
  this.callsByName = new Map(/*
    name: node
  */);

  /**
   * Value references by name.
   * @private
   */
  this.referencesByName = new Map(/*
    name: node
  */);

  /**
   * Nodes which represent getters or setters.
   * @private
   */
  this.accessorNodes = new WeakSet(/* node */);

  /**
   * A mapping of JS scopes to the names of AST nodes local to them.
   * @private
   *
   * @note This is used specifically for constructors, because the code looks
   * for any association between an async node and an await statement in a
   * constructor (which is illegal, but also not our job to fix).  The
   * constructor has a scope which references certain names.  These are the names
   * that might require the async marking on the constructor.
   */
  this.memberNodesInScope = new WeakMap(/*
    scope: new Set(property name from MemberExpression(this), ...)
  */);

  /**
   * @private
   */
  this.nodeToEnclosingFunction = new WeakMap(/*
    node: Function node
  */);

  /**
   * A mapping of property assignments:  A = { b: c };
   * @private
   */
  this.valueNodeToKeyNode = new WeakMap(/*
    value node: key node
  */);

  /**
   * A mapping of nodes to the object that owns them: A.b = function() { return this.c; };
   * @private
   */
  this.valueNodeToThisNode = new WeakMap(/*
    value node: A node that owns the method.
  */);

  /**
   * A mapping of nodes to a matching constructor function.
   * @private
   */
  this.nodeToConstructorFunction = new WeakMap(/*
    node: Function node
  */);

  /**
   * A list of AST nodes we must ignore for async/await annotation.
   * These are black boxes as far as further stack analysis goes.
   *
   * @private
   */
  this.ignoredNodes = new Set();

  /**
   * Nodes which are already enclosed in an AwaitExpression:  await this.a();
   * @private
   */
  this.nodesInAwaitCall = new WeakSet(/* node */);

  /**
   * A set of functions which we think there are instances of them.
   * @private
   */
  this.constructorFunctions = new WeakSet(/* node */);

  /**
   * Listeners which helpfully provide debug breakpoints based on the AST node's location and type.
   * @private
   */
  this.debugByLineListeners = [];
}

JSDriver.prototype = {
  /**
   * Perform an analysis based on a configuration.
   *
   * @param {JSONObject} config      The configuration for this driver.
   * @param {Object}     adjustments Adjustments to the configuration (usually from command-line).
   *
   * @public
   * @returns {Object} A dictionary object:
   *   startAsync: The start node indicated by config.markAsync.
   *   asyncRefs:  Map() of async nodes to corresponding await nodes and their async callers.
   */
  analyzeByConfiguration: async function(config, adjustments = {}) {
    let ignoreFilters = [];
    if (Array.isArray(config.ignore)) {
      ignoreFilters = config.ignore.map(ignoreData =>
        n => n.type === ignoreData.type
      );
    }

    await Promise.all(config.scripts.map(
      script => this.appendJSFile(script)
    ));

    this.parseSources();

    if (Array.isArray(config.ignore)) {
      config.ignore.map((ignore, filterIndex) => {
        if (!("index" in ignore))
          ignore.index = 0;
        const ignorable = this.nodeByLineFilterIndex(
          ignore.path,
          ignore.line,
          ignore.index,
          ignoreFilters[filterIndex]
        );
        this.markIgnored(ignorable);
      });
    }

    if ("newIgnore" in adjustments) {
      const ignorable = this.nodeByLineFilterIndex(
        adjustments.newIgnore.path,
        adjustments.newIgnore.line,
        adjustments.newIgnore.index,
        n => n.type === adjustments.newIgnore.type
      );
      this.markIgnored(ignorable);

      config.ignore.push(adjustments.newIgnore);
    }

    const startAsync = this.functionNodeFromLine(
      config.markAsync.path,
      config.markAsync.line,
      config.markAsync.functionIndex || 0
    );

    const asyncRefs = this.getAsyncStacks(startAsync);

    this.cachedConfiguration = config;

    return { startAsync, asyncRefs };
  },

  /**
   * Get a JSON-serializable configuration object.
   *
   * @param {Node} startAsync The starting async node.
   *
   * @public
   * @returns {Object}
   */
  getConfiguration: function(startAsync) {
    if (this.cachedConfiguration)
      return this.cachedConfiguration;

    let functionIndex = 0;
    {
      const key = this.fileAndLine(startAsync);
      let nodeList = this.nodesByLine.get(key);
      nodeList = nodeList.filter(isFunctionNode);
      functionIndex = nodeList.indexOf(startAsync);
    }

    return {
      type: "javascript",

      options: {
      },

      root: this.rootDir,

      scripts: Array.from(this.sources),

      ignore: Array.from(this.ignoredNodes).map((ignore => {
        return {
          path: ignore.file,
          line: ignore.line,
          type: ignore.type,
          index: this.indexOfNodeOnLine(ignore),
        };
      })),

      markAsync: {
        path: startAsync.file,
        line: startAsync.line,
        functionIndex,
      },
    };
  },

  /**
   * Read a JS file from the filesystem.
   * @param {string} pathToFile The relative path to the file.
   *
   * @public
   */
  appendJSFile: async function(pathToFile) {
    if (this.sources.has(pathToFile))
      return this.sources.get(pathToFile);

    const fullPath = path.resolve(this.rootDir, pathToFile);
    const source = await fs.readFile(fullPath, { encoding: "UTF-8" } );
    this.appendSource(pathToFile, 1, source);
    this.sources.add(pathToFile);
  },

  /**
   * Append source code to the JavaScript to parse.
   * @param {string} pathToFile      The relative path to the file.
   * @param {number} firstLineInFile The line number the source starts at in the file.
   * @param {string} source          The source code to insert.
   *
   * @public
   */
  appendSource: function(pathToFile, firstLineInFile, source) {
    const startSourceLine = this.parsingBuffer.length + 1;
    const addedLines = source.split("\n");
    Array.prototype.push.apply(this.parsingBuffer, addedLines);

    this.lineMapping.push({
      startSourceLine,
      pathToFile,
      firstLineInFile,
      endSourceLine: startSourceLine + addedLines.length
    });
  },

  /**
   * Get a stringified representation of the code we will parse.comment
   *
   * @public
   * @returns {string} The code, annotated by original source file and line number.
   */
  serializeSourceMapping: function() {
    const mappingList = this.lineMapping.slice();
    let rv = "";
    for (let parseLine = 1; parseLine <= this.parsingBuffer.length; parseLine++) {
      while (parseLine >= mappingList[0].endSourceLine)
        mappingList.shift();

      const printLine = parseLine - mappingList[0].startSourceLine + mappingList[0].firstLineInFile;
      rv += `${mappingList[0].pathToFile}:${printLine.toString().padStart(4, '0')} ${this.parsingBuffer[parseLine - 1]}\n`;
    }
    return rv;
  },

  /**
   * Mark a node ignored for purposes of await/async marking.
   * No recursive descent into callers for purposes of await/async marking will happen.
   *
   * @note StackLizard will have bugs.  One example is matching a node that it shouldn't.
   * See fixtures/object-define-name-mismatch/fixture.js where it calls B.b().  As I
   * write this, StackLizard will normally pick that up and mark it await.  This method
   * is to override StackLizard and tell it to ignore a node.
   *
   * @param {Node} node The node to mark ignored.
   *
   * @public
   */
  markIgnored: function(node) {
    this.ignoredNodes.add(node);
  },

  /**
   * Parse the source code in our buffer, and gather the metadata.
   * @public
   */
  parseSources: function() {
    const ast = espree.parse(this.parsingBuffer.join("\n"), sourceOptions);
    const listeners = new MultiplexListeners();

    // First pass, build up references to files, line numbers, and JS scopes.
    // Prototype lookups may need this to complete before they run.
    {
      const scopeManager = eslintScope.analyze(ast, {ecmaVersion: 2020});
      listeners.append(this.lineMappingListener());
      listeners.append(this.currentScopeListener(ast, scopeManager));
      estraverse.traverse(ast, listeners);
      listeners.clear();
    }

    // Second pass, gather our data.
    this.debugByLineListeners.forEach(listener => listeners.append(listener));

    listeners.append({
      enter: (node) => {
        if (node.type === "AssignmentExpression") {
          // a = b;
          this.valueNodeToKeyNode.set(node.right, node.left);
        }
        else if (node.type === "Property") {
          // a = {b : 0};
          this.valueNodeToKeyNode.set(node.value, node.key);

          // a = { get b() { return 0; }};
          if (node.kind !== "init") {
            this.accessorNodes.add(node.value);
          }
        }
      }
    });

    listeners.append(this.prototypeListener());

    listeners.append({
      enter: (node, parent) => {
        if (("id" in node) ||
            (node.type === "CallExpression") || // a()
            (node.type === "MemberExpression") || // a.b
            (node.type === "NewExpression")) // new a()
        {
          this.referencesByNameRecorder(node, parent);
        }
      }
    });

    listeners.append(this.functionStackListener());
    listeners.append(this.awaitExpressionListener());

    estraverse.traverse(ast, listeners);
  },

  /**
   * Map each AST node to its originating source file and line.
   * @private
   */
  lineMappingListener: function() {
    const mappingList = this.lineMapping.slice();
    return {
      enter: (node) => {
        const parseLine = node.loc.start.line;
        while (parseLine >= mappingList[0].endSourceLine)
          mappingList.shift();
        const mapping = mappingList[0];

        node.file = mapping.pathToFile;
        node.line = parseLine - mapping.startSourceLine + mapping.firstLineInFile;

        const hash = `${mapping.pathToFile}:${node.line}`;
        if (!this.nodesByLine.has(hash))
          this.nodesByLine.set(hash, []);
        this.nodesByLine.get(hash).push(node);
      }
    };
  },

  /**
   * Associate each AST node with a JavaScript scope.
   * @param {AST} ast      From espree
   * @param {ScopeManager} manager From eslint-scope
   *
   * @private
   */
  currentScopeListener: function(ast, manager) {
    let currentScope = manager.acquire(ast);
    return {
      enter: (node) => {
        this.nodeToScope.set(node, currentScope);
        if (isFunctionNode(node)) {
          // get current function scope
          currentScope = manager.acquire(node);
        }
      },
      leave: (node) => {
        if (isFunctionNode(node)) {
          // set to parent scope
          currentScope = currentScope.upper;
        }
      }
    };
  },

  /**
   * Keep track of a stack of functions in the parse tree.
   * @private
   */
  functionStackListener: function() {
    this.functionStack = [];
    return {
      enter: (node) => {
        if (isFunctionNode(node)) {
          this.functionStack.unshift(node);
        }
        else if (this.functionStack.length) {
          const current = this.functionStack[0];
          this.nodeToEnclosingFunction.set(node, current);

          if (isMemberThis(node)) {
            if (!this.memberNodesInScope.has(current))
              this.memberNodesInScope.set(current, new Set());
            this.memberNodesInScope.get(current).add(node.property);
          }
        }
      },

      leave: (node) => {
        if (isFunctionNode(node)) {
          this.functionStack.shift();
        }
      }
    };
  },

  /**
   * Record nodes that are already marked await in the source.
   *
   * @example await this.getPromise();
   * @private
   */
  awaitExpressionListener: function() {
    var awaitCount = 0;
    return {
      enter: (node) => {
        if (node.type === "AwaitExpression")
          awaitCount++;
        else if (awaitCount) {
          this.nodesInAwaitCall.add(node);
        }
      },
      leave: (node) => {
        if (node.type === "AwaitExpression")
          awaitCount--;
      }
    };
  },

  /**
   * Create a listener which triggers debugging breakpoints.
   * @param {string} file The relative path to the original file.
   * @param {number} line The line number in the original file.
   *
   * @public
   * @note This shouldn't be used in Production code, only to
   * strategically define breakpoints based on AST nodes at a
   * specific location.
   */
  debugByLine: function(file, line) {
    this.debugByLineListeners.push({
      enter: (node) => {
        voidFunc(this);
        if ((node.file === file) && (node.line === line))
          debugger; // eslint-disable-line no-debugger
      }
    });
  },

  /**
   * Manage associations with function prototypes.
   *
   * @private
   */
  prototypeListener: function() {
    this.prototypeStack = [];
    return {
      enter: (node) => {

        // A.prototype = { b: function() { ... } };
        if ((node.type === "AssignmentExpression") && isPrototypeMember(node.left))
          this.prototypeStack.unshift(node.left.object);

        // A.prototype.b = function() { ... };
        else if (isPrototypeAssignMethod(node)) {
          let ctorNode = this.getConstructorFunction(node.left.object.object);
          if (ctorNode) {
            this.nodeToConstructorFunction.set(node.right, ctorNode);
          }
        }
      },

      leave: (node) => {
        if ((node.type === "AssignmentExpression") && isPrototypeMember(node.left))
          this.prototypeStack.shift();
      }
    };
  },

  /**
   * Manage references to other nodes.
   * @param {*} node
   *
   * @private
   */
  referencesByNameRecorder: function(node) {
    // A.prototype = { b: true };, looking at b
    if (this.prototypeStack.length) {
      let ctorNode = this.getConstructorFunction(this.prototypeStack[0]);
      if (ctorNode) {
        this.nodeToConstructorFunction.set(node, ctorNode);
      }
    }

    // X = new A()
    if (node.type === "NewExpression") {
      let ctorNode = this.getConstructorFunction(node.callee);
      if (ctorNode) {
        this.constructorFunctions.add(ctorNode);
      }
    }

    if (this.ignoredNodes.has(node) || this.accessorNodes.has(node))
      return;

    let map;
    if ((node.type === "CallExpression") ||
        (node.type === "NewExpression")) {
      // a(), new A
      map = this.callsByName;
    }
    else {
      // any other reference
      map = this.referencesByName;
    }

    const name = this.getNodeName(node);
    if (!map.get(name))
      map.set(name, []);
    map.get(name).push(node);
  },

  /**
   * Get a (probable) constructor node based on another node naming it in a scope.
   * @param {Node} refNode A node referencing the name of a constructor.
   *                       Most likely, an Identifier node.
   * @private
   */
  getConstructorFunction: function(refNode) {
    const name = this.getNodeName(refNode);
    let scope = this.nodeToScope.get(refNode);

    while (scope && !scope.set.has(name))
      scope = scope.upper;

    if (!scope)
      return;

    // see eslint-scope for help if this doesn't work right
    const variable = scope.set.get(name);
    const definition = variable.defs[0];
    return definition.node;
  },

  /**
   * Get a good approximation of the name a node has.
   * @param {Node} node
   *
   * @public
   * @throws for unknown node types
   */
  getNodeName: function(node) {
    if (this.valueNodeToKeyNode.has(node))
      return this.getNodeName(this.valueNodeToKeyNode.get(node));

    if (isFunctionNode(node)) {
      return node.id ? this.getNodeName(node.id) : "(lambda)";
    }

    switch (node.type) {
      case "ArrayPattern":
        return `[ ${node.elements.map(n => this.getNodeName(n))} ]`;
      case "BinaryExpression":
        return `${this.getNodeName}`
      case "CallExpression":
        return this.getNodeName(node.callee);
      case "Identifier":
        return node.name;
      case "Literal":
        return node.raw;
      case "MemberExpression":
        return this.getNodeName(node.property);
      case "NewExpression":
        return this.getNodeName(node.callee);
      case "ObjectPattern":
        return `{ ${node.properties.map(n => this.getNodeName(n))} }`;
      case "Property":
        return this.getNodeName(node.key);
      case "ThisExpression":
        return "this";
      case "VariableDeclarator":
        return this.getNodeName(node.id);
    }

    // I just haven't hit it yet in testing.
    throw new Error(
      `Unknown node type: ${node.type} for ${this.fileAndLine(node)}@${node.loc.start.column}`
    );
  },

  /**
   * Get a node from the cached AST.
   * @param {string} pathToFile The source file.
   * @param {number} lineNumber The line number of that source file.
   * @param {number} index      An index to apply after pathToFile, lineNumber,
   *                            and filter.
   * @param {Function} filter   A filter to apply after pathToFile, lineNumber.
   *
   * @public
   * @returns {Node}
   *
   * @note You may think "why not put the index at the end?  It's the last part."
   * You're not wrong to think that.  But the filter is a function, and the other
   * arguments are primitives.  For code readability, I put the primitives first.
   */
  nodeByLineFilterIndex: function(pathToFile, lineNumber, index, filter) {
    const key = pathToFile + ":" + lineNumber;
    let nodeList = this.nodesByLine.get(key);
    if (!nodeList)
      throw new Error("No functions found at " + key);

    nodeList = nodeList.filter(filter);
    return nodeList[index] || null;
  },

  /**
   * Given an AST node, find its index on a line after filtering for its type.
   * @param {Node} node The AST node.
   *
   * @private
   * returns {number} The index of the node after filtering.
   *
   * @note This is effectively the inverse of nodeByLineFilterIndex().
   */
  indexOfNodeOnLine: function(node) {
    const key = node.file + ":" + node.line;
    let nodeList = this.nodesByLine.get(key);
    if (!nodeList)
      throw new Error("No functions found at " + key);
    nodeList = nodeList.filter(n => n.type === node.type);
    return nodeList.indexOf(node);
  },

  /**
   * Find a particular FunctionExpression node from a given file and line.
   * @param {string} pathToFile    The relative file path.
   * @param {number} lineNumber    The line number in the file.
   * @param {number} functionIndex The index of the function on the line.
   *
   * @public
   * @returns {Node} The function's node in the cached AST.
   *
   * @note functionIndex isn't as unreasonable as it may sound.  It's common to
   *       have lambda functions on the same line as a parent function.
   */
  functionNodeFromLine: function(pathToFile, lineNumber, functionIndex = 0) {
    return this.nodeByLineFilterIndex(pathToFile, lineNumber, functionIndex, isFunctionNode);
  },

  /**
   * Mark a node asynchronous, and generate stack traces which indicate other
   * nodes to mark async and await.
   *
   * @param {Node} functionNode The first AST node to mark async.
   *
   * @public
   * @returns Map() of async nodes to corresponding await nodes and their async callers.
   */
  getAsyncStacks: function(functionNode) {
    // return
    const asyncReferences = new Map(/*
      async node: [
        {
          awaitNode: node that references the key async node,
          asyncNode: function that is an ancestor of the await node,
        },
        ...
      ]
    */);

    // The root of our async stack trees.
    asyncReferences.set(null, [{
      asyncNode: functionNode,
    }]);

    /* The list of async nodes grows as we iterate.  So we use markedAsync
    nodes to track them and scheduledAsyncNodes to avoid duplication.
    */
    const markedAsyncNodes = [functionNode];
    const scheduledAsyncNodes = new Set(markedAsyncNodes);

    for (let i = 0; i < markedAsyncNodes.length; i++) {
      const asyncNode = markedAsyncNodes[i];
      if (this.ignoredNodes.has(asyncNode))
        continue;

      const awaitNodes = this.getAwaitNodes(asyncNode);
      if (awaitNodes.length === 0)
        continue;

      const references = [/*
        newly marked awaitNode, and its enclosing newly marked asyncNode
      */];
      asyncReferences.set(asyncNode, references);

      // Finally, gather the callers to mark them async.
      awaitNodes.forEach((awaitNode) => {
        if (this.ignoredNodes.has(awaitNode))
          return;

        // Officially mark this node as await.
        const refData = { awaitNode };
        references.push(refData);

        const nextAsyncNode = this.nodeToEnclosingFunction.get(awaitNode);
        if (!nextAsyncNode || this.ignoredNodes.has(nextAsyncNode))
          return;

        // Officially mark this node as async, if it isn't already.
        refData.asyncNode = nextAsyncNode.async ? null : nextAsyncNode;

        // Schedule the next async node, if necessary.
        if (scheduledAsyncNodes.has(nextAsyncNode))
          return;
        scheduledAsyncNodes.add(nextAsyncNode);
        markedAsyncNodes.push(nextAsyncNode);
      });
    }

    return asyncReferences;
  },

  /**
   * Get a list of nodes possibly referencing a particular async node.
   *
   * @param {ASTNode} asyncNode
   *
   * @private
   * @returns {Node[]} The list of await nodes.
   */
  getAwaitNodes: function(asyncNode) {
    const asyncScope = this.nodeToScope.get(asyncNode);
    const asyncName = this.getNodeName(asyncNode);

    // function calls
    let maybeAwaitNodes = this.callsByName.get(asyncName) || [];

    // direct references
    if (this.accessorNodes.has(asyncNode)) {
      maybeAwaitNodes = maybeAwaitNodes.concat(this.referencesByName.get(asyncName));
    }

    // constructor reference
    {
      let ctorNode = this.nodeToConstructorFunction.get(asyncNode);

      // memberNodes is a list of nodes the constructor references.
      let memberNodes = null;
      if (ctorNode) {
        memberNodes = this.memberNodesInScope.get(ctorNode);
      }

      if (memberNodes) {
        memberNodes.forEach(n => {
          if (this.getNodeName(n) === asyncName)
            maybeAwaitNodes.push(n);
        });
      }
    }

    return maybeAwaitNodes.filter((maybe) => {
      if (this.nodesInAwaitCall.has(maybe))
        return false;

      let awaitScope = this.nodeToScope.get(maybe);
      while (awaitScope) {
        if (awaitScope === asyncScope)
          return true;

        awaitScope = awaitScope.upper;
      }

      return false;
    });
  },

  /**
   * @private
   */
  fileAndLine(node) {
    return node.file + ":" + node.line;
  },

  /**
   * Generate a serialization of the node's important properties.
   * @param {Node} node The node to serialize.
   *
   * @public
   * @returns {string} The serialization of the node.
   */
  serializeNode: function(node) {
    let rv = `${this.fileAndLine(node)} ${node.type}[${this.indexOfNodeOnLine(node)}]`;
    if (this.accessorNodes.has(node)) {
      rv += ", accessor";
    }
    if (this.constructorFunctions.has(node)) {
      rv += ", constructor";
    }
    return rv;
  },

  /**
   * Report if a node we marked async cannot have an async keyword on it.
   *
   * @param {Node} node The node to check.
   *
   * @public
   * @returns {Boolean}
   */
  isAsyncSyntaxError: function(node) {
    return this.accessorNodes.has(node) ||
           this.constructorFunctions.has(node);
  },
};

module.exports = JSDriver;
