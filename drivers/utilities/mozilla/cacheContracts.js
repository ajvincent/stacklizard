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

// MacOS support to keep things moving relatively fast.  Without this it would take a lot longer.
// @private
const DarwinTools = {
  /**
   * Create a Promise like Promise.all() which batches its operations.
   * @param {Array}    items     The starting items.
   * @param {Function} mapper    Convert each item to a Promise.
   * @param {Number}   batchSize The number of items per batch.
   *
   * @returns {Promise}
   */
  mapToBatch(items, mapper, batchSize) {
    let results = [];
    let promiseBatch = Promise.resolve();
    items = items.slice(0);
    let batchCount = 0, batchTotal = 0;

    while (items.length) {
      batchTotal++;
      const subItems = items.splice(0, batchSize);
      let subStart;
      let subPromise = new Promise(resolve => subStart = resolve);
      subPromise = subPromise.then(() => {
        batchCount++;
        console.log(`batch ${batchCount} of ${batchTotal}`);
        return Promise.all(subItems.map(mapper));
      });
      subPromise = subPromise.then(subResults => results.push(subResults));
      promiseBatch.then(subStart);
      promiseBatch = subPromise;
    }

    promiseBatch = promiseBatch.then(() => results.flat(1));
    return promiseBatch;
  },

  /**
   * Get a list of JavaScript & HTML files from a repository clone.
   * @param {string} pathToRepo The absolute path to the mozilla repository's local checkout.
   *
   * @returns {string[]} The list of files as relative paths from the clone root.
   */
  async getFileList(pathToRepo) {
    let promises = [
      "*.js",
      "*.jsm",
      "*.xhtml",
    ].map(async (pattern) => {
      let args = [
        ".",
        "-name",
        pattern,
        "-type",
        "f",
      ];

      const { stdout: matchFiles } = await execFile(
        "find",
        args,
        {
          cwd: pathToRepo,
          shell: true,
          maxBuffer: 16 * 1024 * 1024,
        }
      );

      let rv = matchFiles.split("\n");
      rv.pop();
      return rv.map(item => item.substr(2));
    });

    let fileList = await Promise.all(promises);
    fileList = fileList.flat();
    fileList = fileList.filter(path => !path.startsWith("."));
    fileList.sort();
    return fileList;
  },

  /**
   * Invoke grep on a single file for a sequence of contract strings.
   *
   * @param {string} filePath        A path to the file that may contain the contract.
   * @param {string} contractStrings The contracts separated by new lines.
   */
  async getContractLines(filePath, contractStrings) {
    // grep -Hn --color=never --fixed-strings ${contractStrings} toolkit/mozapps/update/UpdateService.jsm
    const args = [
      "-Hn",
      "--color=never",
      "--fixed-strings",
      contractStrings,
      filePath
    ];

    try {
      const {stdout: matchFiles} = await execFile(
        "grep",
        args,
        {
          cwd: "/Users/ajvincent/compiled/update-mgr/mozilla-central",
          shell: true,
        }
      );

      let rv = matchFiles.split("\n");
      rv.pop();
      return rv;
    }
    catch (ex) {
      return [];
    }
  },

  /**
   * Extract all locations of all contract IDs in a repository clone.
   * @param {string} pathToRepo The absolute path to the mozilla repository's local checkout.
   * @param {*} contractStrings The contracts separated by new lines.
   *
   * @returns {string[]} The list of matches.
   */
  async getAllContractLines(pathToRepo, contractStrings) {
    console.timeLog("mozilla", "Extracting contract lines via grep");
    const fileList = await this.getFileList(pathToRepo);
    console.timeLog("mozilla", "Found " + fileList.length + " files with extension .js, .jsm or .xhtml");
    let p = this.mapToBatch(
      fileList,
      (filePath) => this.getContractLines(filePath, contractStrings),
      2048
    );
    p = p.then(rv => {
      console.timeLog("mozilla", "Completed extracting contract lines");
      return rv.flat().filter(Boolean);
    });
    return p;
  },
};

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
 * @param {Map} jsFiles leafName: extracted locations
 *
 * @see cacheContracts()
 */
async function findHTMLFilesLoadingJS(pathToRepo, jsFiles) {
  // Record the XHTML files trying to load the found JS files.
  console.timeLog("mozilla", "Looking for XHTML files loading the JS files");
  const jsFileKeys = Array.from(jsFiles.keys());
  const scriptsList = `"${jsFileKeys.join("\n")}"`;
  let { stdout: xhtmlLines } = await execFile(
    "grep",
    [
      "--include=*.xhtml",
      "-rn",
      "--fixed-strings",
      scriptsList,
      ".",
    ],
    {
      cwd: pathToRepo,
      shell: true,
    }
  );
  const xhtmlData = xhtmlLines.split("\n").map(extractLocations).filter(Boolean);
  xhtmlData.sort(sortLocations);
  console.timeLog("mozilla", "Found the XHTML files:" + xhtmlData.length);

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

  let locationData;
  if (process.platform === "darwin") {
    /* Sure, you could alter the parameters passed to grep, as I did.  But oh,
    man, is it dog slow, about three orders of magnitude worse than on Linux.
    So, I break it up into smaller tasks, where a find command generates a list
    of files to feed into grep.  It is significantly faster than a direct grep
    call, but doesn't yet approach the performance on Linux.  It's just good
    enough to be tolerable, especially with log lines indicating progress.

    Feel free to optimize further!
    */
    const contractLines = await DarwinTools.getAllContractLines(pathToRepo, contractList);
    locationData = contractLines.map(extractLocations).filter(Boolean);
  }
  else {
    const params = [
      "--include=*.js",
      "--include=*.jsm",
      "--include=*.xhtml",
      "--color=never",
      "-rn",
      "--fixed-strings",
      contractList,
      ".",
    ];

    let { stdout: sourceLines } = await execFile(
      "grep",
      params,
      {
        cwd: pathToRepo,
        shell: true,
      }
    );

    locationData = sourceLines.split("\n").map(extractLocations).filter(Boolean);
  }
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

  await findHTMLFilesLoadingJS(pathToRepo, jsFiles);

  return results;
}

module.exports = cacheContracts;
