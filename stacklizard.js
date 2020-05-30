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
  foundAncestors: Symbol("Found ancestors"),
};

function StackLizard(rootDir, options = {}) {
  this.rootDir = rootDir;
  this.options = options;
  this.sources = new Map(/*
    path: espree.parse(...)
  */);
}
StackLizard.prototype = {
  parseJSFile: async function(pathToFile) {
    const fullPath = path.join(process.cwd(), this.rootDir, pathToFile);
    const source = await fs.readFile(fullPath, { encoding: "UTF-8"} );
    const ast = espree.parse(source, sourceOptions);
    this.sources.set(pathToFile, ast);
    return ast;
  },

  ancestorsJS: function(pathToFile, lineNumber, functionIndex = 1) {
    const ast = this.sources.get(pathToFile);
    let found = null, hits = 0;

    try {
      acornWalk.ancestor(ast, {
        FunctionExpression(_, ancestors) {
          if ((_.loc.start.line != lineNumber))
            return;
          hits++;
          if (hits == functionIndex) {
            found = ancestors;
            throw SYMBOLS.foundAncestors;
          }
        }
      });
    }
    catch (ex) {
      if (ex !== SYMBOLS.foundAncestors)
        throw ex;
    }

    return found;
  },
};

module.exports = StackLizard;
