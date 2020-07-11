"use strict";

/**
 * @fileoverview
 * This module takes classes data extracted from the xpcom-classes module, and generates a Map
 * detailing where the contract ID's are referenced in the Mozilla code.  For JavaScript files,
 * the module also tries to locate HTML files that load them.
 */

const path = require("path");

const findHTMLFilesLoadingJS = require("./findHTMLFilesLoadingJS");
const findFilesContaining = require("./findFilesContainingStrings");

/**
 * Build a map of contract IDs to all calling references.
 *
 * @param {string}   pathToRepo The absolute file path to the local repository clone.
 * @param {Object[]} classData  The class data objects to scan through.
 *
 * @returns {Map} of contract IDs to references.
 *
 * @see xpcom-classes.js
 */
async function cacheContracts(pathToRepo, classData) {
  const contracts = classData.map(d => d.contract_ids).filter(Boolean).flat();
  contracts.sort();

  // Get all the references to all the contracts.
  const contractList = `"${contracts.join("\n")}"`;

  const locationData = await findFilesContaining(pathToRepo, contractList);
  const jsFiles = new Map(/* leafName: extracted locations */);

  const results = new Map(/*
    contractID: [
      {
        fileWithLine,
        path,
        line,
        source,
        xhtmlFiles: [
          {
            fileWithLine,
            path,
            line,
            source,
          }
        ]
      }
    ]
  */);

  // Map the file locations to the matching contract IDs, and cache JS files we want loaders for.
  contracts.forEach(c => {
    const row = [];
    results.set(c, row);
    for (let i = locationData.length - 1; i--; i >= 0) {
      const data = locationData[i];
      if (!data.source.includes(c)) {
        continue;
      }

      row.unshift(data);
      locationData.splice(i, 1); // to reduce the search space in an O(m * n) operation

      if (data.path.endsWith(".js")) {
        const leaf = "/" + path.basename(data.path);
        if (!jsFiles.has(leaf))
          jsFiles.set(leaf, []);
        jsFiles.get(leaf).push(data);
      }
    }
  });

  await findHTMLFilesLoadingJS(pathToRepo, jsFiles);

  return results;
}

module.exports = cacheContracts;
