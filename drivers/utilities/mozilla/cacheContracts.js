"use strict";

/**
 * @fileoverview
 * This module takes classes data extracted from the xpcom-classes module, and generates a Map
 * detailing where the contract ID's are referenced in the Mozilla code.  For JavaScript files,
 * the module also tries to locate HTML files that load them.
 */

const util = require('util');
const path = require("path");
const execFile = util.promisify(require('child_process').execFile);

const grepRE = /^([^:]+):([^:]+):/;

/**
 * Extract information about a file match into a JSON object, containing the
 * file path, a line number, and the source code.
 *
 * @param {string} fileWithLine
 *
 * @returns {Object} The JSON object.
 */
function extractLocations(fileWithLine) {
  if (!fileWithLine)
    return null;

  const matches = grepRE.exec(fileWithLine);
  if (!matches) {
    console.error(fileWithLine);
    throw new Error("No match found for fileWithLine");
  }

  const parts = Array.from(matches);
  return {
    fileWithLine,
    path: parts[1],
    line: parseInt(parts[2], 10),
    source: fileWithLine.substr(fileWithLine.indexOf(parts[1]) + parts[1].length + 1),
  };
}

function sortLocations(a, b) {
  if (a.path < b.path)
    return -1;
  if (a.path > b.path)
    return +1;

  return Math.sign(a.line - b.line);
}

/**
 * Build a map of contract IDs to all calling references.
 *
 * @param {string}   pathToRepo The absolute file path to the local repository clone.
 * @param {Object[]} classData  The class data objects to scan through.comment
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
  let { stdout: sourceLines } = await execFile(
    "grep",
    [
      "--include=*.js",
      "--include=*.jsm",
      "--include=*.xhtml",
      "--include=*.h",
      "--include=*.cpp",
      "--include=*.idl",
      "--color=never",
      "-rn",
      "--fixed-strings",
      contractList,
    ],
    {
      cwd: pathToRepo,
      shell: true,
    }
  );

  const locationData = sourceLines.split("\n").map(extractLocations).filter(Boolean);
  locationData.sort(sortLocations);

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

  // Record the XHTML files trying to load the found JS files.
  const jsFileKeys = Array.from(jsFiles.keys());
  const scriptsList = `"${jsFileKeys.join("\n")}"`;
  let { stdout: xhtmlLines } = await execFile(
    "grep",
    [
      "--include=*.xhtml",
      "-rn",
      "--fixed-strings",
      scriptsList,
    ],
    {
      cwd: pathToRepo,
      shell: true,
    }
  );
  const xhtmlData = xhtmlLines.split("\n").map(extractLocations).filter(Boolean);
  xhtmlData.sort(sortLocations);

  // Attach the XHTML files to the JS files that load them.
  jsFileKeys.forEach(leaf => {
    const row = jsFiles.get(leaf);
    for (let i = xhtmlData.length - 1; i--; i >= 0) {
      const xhtmlEntry = xhtmlData[i];
      if (!xhtmlEntry.source.includes(leaf)) {
        continue;
      }

      xhtmlData.splice(i, 1); // more O(m * n) cleanup

      row.forEach(scriptItem => {
        if (typeof scriptItem.xhtmlFiles === "undefined")
          scriptItem.xhtmlFiles = [];
        scriptItem.xhtmlFiles.push(xhtmlEntry);
      });
    }
  });

  return results;
}

module.exports = cacheContracts;
