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

  definedOn: function(ancestors) {
    let rv = {
      name: "",
      directParentNode: null,
      directParentName: "",
      ctorParentName: null,
    }
    ancestors.reverse();
    ancestors.shift(); // this would be the definition of the function itself

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
};

module.exports = StackLizard;
