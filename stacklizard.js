"use strict";
const espree = require("espree");
const fs = require("fs").promises;
const path = require("path");

const sourceOptions = {
  loc: true,
  ecmaVersion: 2020,
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
  }
};

module.exports = StackLizard;
