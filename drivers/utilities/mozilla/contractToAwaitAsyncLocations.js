"use strict";
const JSDriver = require("../../javascript");

/**
 * Convert a contract ID on one file's line to metadata to find the equivalent await & async nodes later.
 * @param {string} rootDir    The root directory of the configuration.
 * @param {Object} options    Options to use in parsing.
 * @param {string} path       The path to the file.
 * @param {number} line       The line number of the contract ID.
 * @param {string} contractId The actual contract ID.
 *
 * @returns {Object} containing awaitLocation, asyncLocation.
 */
async function contractToAwaitAsyncLocations(rootDir, options, path, line, contractId) {
  const driver = new JSDriver(rootDir, options);
  await driver.appendJSFile(path);
  driver.parseSources();

  const awaitLocation = {
    path,
    line,
    type: "Literal",
    index: -1,
  };

  {
    const key = path + ":" + line;
    let nodeList = driver.nodesByLine.get(key);
    if (!nodeList)
      throw new Error("No functions found at " + key);

    nodeList = nodeList.filter(n => n.type === "Literal");
    awaitLocation.index = nodeList.findIndex(n => JSON.parse(n.raw) === contractId);
  }

  const awaitNode = driver.nodeByLineFilterIndex(
    path,
    line,
    awaitLocation.index,
    n => n.type === "Literal"
  );
  const asyncNode = driver.nodeToEnclosingFunction.get(awaitNode);
  if (!asyncNode)
    return {awaitLocation};

  const asyncLocation = {
    path,
    line: asyncNode.line,
    type: asyncNode.type,
    index: driver.indexOfNodeOnLine(asyncNode)
  }

  return {awaitLocation, asyncLocation};
}

module.exports = contractToAwaitAsyncLocations;
