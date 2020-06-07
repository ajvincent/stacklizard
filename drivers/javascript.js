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
const eslintScope = require('eslint-scope');
const estraverse = require('estraverse');

/**
 * @private
 */
const sourceOptions = {
  loc: true,
  ecmaVersion: 2020,
  range: true,
};

function voidFunc() {};

function TraverseListeners() {
  this.listenersEnter = [];
  this.listenersLeave = [];

  this.enter = this.enter.bind(this);
  this.leave = this.leave.bind(this);
}

TraverseListeners.prototype.append = function(listener) {
  this.listenersEnter.push(listener.enter || voidFunc);
  this.listenersLeave.unshift(listener.leave || voidFunc);
};
TraverseListeners.prototype.enter = function(node, parent) {
  this.listenersEnter.forEach(listener => listener(node, parent));
};
TraverseListeners.prototype.leave = function(node, parent) {
  this.listenersLeave.forEach(listener => listener(node, parent));
};

function isFunctionNode(node) {
  return node.type.includes("Function");
}

/**
 * @constructor
 */
function JSDriver() {
  this.parsingBuffer = [];
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

  this.nodeToScope = new WeakMap(/*
    node: scope
  */);

  this.referencesByName = new Map(/*
    name: node
  */);

  this.nodeToEnclosingFunction = new WeakMap(/*
    node: Function node
  */);

  this.currentScope = null;
}
JSDriver.prototype = {
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

  serializeSourceMapping: function() {
    const mappingList = this.lineMapping.slice();
    let rv = "";
    for (let parseLine = 1; parseLine <= this.parsingBuffer.length; parseLine++) {
      while (parseLine >= mappingList[0].endSourceLine)
        mappingList.shift();

      const printLine = parseLine - mappingList[0].startSourceLine + mappingList[0].firstLineInFile;
      rv += `${mappingList[0].pathToFile}:${printLine.toString()} ${this.parsingBuffer[parseLine - 1]}\n`;
    }
    return rv;
  },

  parseSources: function() {
    const ast = espree.parse(this.parsingBuffer.join("\n"), sourceOptions);
    const scopeManager = eslintScope.analyze(ast, {ecmaVersion: 2020});

    const listeners = new TraverseListeners;

    listeners.append(this.lineMappingListener());

    listeners.append({
      enter: (node) => this.nodeToScope.set(node, this.currentScope)
    });

    listeners.append({
      enter: (node, parent) => {
        if (node.type === "CallExpression") {
          this.enterCallExpression(node, parent);
        }
      }
    });

    listeners.append(this.functionStackListener());
    listeners.append(this.currentScopeListener(ast, scopeManager));

    estraverse.traverse(ast, listeners);
  },

  lineMappingListener: function() {
    const mappingList = this.lineMapping.slice();
    return {
      enter: (node, parent) => {
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

  functionStackListener: function() {
    var functionStack = [];
    return {
      enter: (node) => {
        if (isFunctionNode(node)) {
          functionStack.unshift(node);
        }
        else if (functionStack.length) {
          this.nodeToEnclosingFunction.set(node, functionStack[0]);
        }
      },

      leave: (node) => {
        if (isFunctionNode(node)) {
          functionStack.shift();
        }
      }
    };
  },

  currentScopeListener: function(ast, scopeManager) {
    this.currentScope = scopeManager.acquire(ast);
    return {
      enter: (node, parent) => {
        if (isFunctionNode(node)) {
          // get current function scope
          this.currentScope = scopeManager.acquire(node);
        }
      },
      leave: (node, parent) => {
        if (isFunctionNode(node)) {
          // set to parent scope
          this.currentScope = this.currentScope.upper;
        }
      }
    };
  },

  enterCallExpression: function(node, parent) {
    const name = node.callee.name;
    if (!name)
      throw new Error("enterCallExpression missing name");

    if (!this.referencesByName.get(name))
      this.referencesByName.set(name, []);
    this.referencesByName.get(name).push(node);
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
    if (!nodeList)
      throw new Error("No functions found at " + key);
    nodeList = nodeList.filter(isFunctionNode);
    return nodeList[functionIndex] || null;
  },

  /**
   * Mark a node asynchronous, and generate stack traces which indicate other
   * nodes to mark async and await.
   * @public
   */
  getAsyncStacks: function(functionNode) {
    // @return
    const markedAsyncNodes = [functionNode];
    const scheduledAsyncNodes = new Set(markedAsyncNodes);

    const asyncReferences = new Map(/*
      async node: [
        {
          awaitNode: node that references the key async node,
          asyncNode: function that is an ancestor of the await node,
          asyncName: name of the ancestor function (hopefully jsDriver can provide this via a method)
        },
        ...
      ]
    */);

    asyncReferences.set(null, [{
      asyncNode: functionNode,
      asyncName: functionNode.id.name,
    }]);

    for (let i = 0; i < markedAsyncNodes.length; i++) {
      const asyncNode = markedAsyncNodes[i];

      const name = asyncNode.id.name;
      if (!name) {
        throw new Error("don't have the name for this node?");
      }

      const awaitNodes = this.getAwaitNodes(asyncNode);
      if (awaitNodes.length === 0)
        continue;

      const references = [];
      asyncReferences.set(asyncNode, references);

      awaitNodes.forEach((awaitNode) => {
        const refData = { awaitNode };
        references.push(refData);

        const nextAsyncNode = this.nodeToEnclosingFunction.get(awaitNode);
        if (!nextAsyncNode)
          return;
        refData.asyncNode = nextAsyncNode;
        refData.asyncName = nextAsyncNode.id.name;

        if (scheduledAsyncNodes.has(nextAsyncNode))
          return;
        scheduledAsyncNodes.add(nextAsyncNode);
        markedAsyncNodes.push(nextAsyncNode);
      });
    }

    return asyncReferences;
  },

  /**
   * @param {ASTNode} asyncNode
   * @private
   */
  getAwaitNodes: function(asyncNode) {
    const asyncScope = this.nodeToScope.get(asyncNode);
    const rv = [];

    // direct references
    {
      const maybeAwaitNodes = this.referencesByName.get(asyncNode.id.name) || [];

      rv.push(maybeAwaitNodes.filter((maybe) => {
        let awaitScope = this.nodeToScope.get(maybe);
        while (awaitScope) {
          // to do:  return false if awaitScope has a matching name
          // rewrite this to be if (awaitScope has name) return awaitScope === asyncScope;

          if (awaitScope === asyncScope)
            return true;

          awaitScope = awaitScope.upper;
        }
        return false;
      }));
    }

    return rv.flat();
  },

  fileAndLine(node) {
    return node.file + ":" + node.line;
  }
};

module.exports = JSDriver;
