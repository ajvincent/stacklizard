"use strict";

const util = require('util');
const execFile = util.promisify(require('child_process').execFile);
const { extractLocations, sortLocations } = require("./extractAndSort");

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
    const filesByExtension = require("./filesByExtension");
    let promises = [
      "js",
      "jsm",
      "xhtml",
    ].map((extension) => filesByExtension(pathToRepo, extension));

    let fileList = await Promise.all(promises);
    fileList = fileList.flat();
    fileList = fileList.filter(path => !path.startsWith("."));
    fileList.sort();
    return fileList;
  },

  /**
   * Invoke grep on a single file for a sequence of fixed strings.
   *
   * @param {string} filePath     A path to the file that may contain the strings.
   * @param {string} fixedStrings The fixed strings separated by new lines.
   */
  async getMatchesInFile(filePath, fixedStrings) {
    // grep -Hn --color=never --fixed-strings ${fixedStrings} toolkit/mozapps/update/UpdateService.jsm
    const args = [
      "-Hn",
      "--color=never",
      "--fixed-strings",
      fixedStrings,
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
   * @param {string}   pathToRepo   The absolute path to the mozilla repository's local checkout.
   * @param {string[]} fixedStrings The fixed strings separated by new lines.
   *
   * @returns {string[]} The list of matches.
   */
  async findFilesContaining(pathToRepo, fixedStrings) {
    console.timeLog("mozilla", "Extracting contract lines via grep");
    const fileList = await this.getFileList(pathToRepo);
    console.timeLog("mozilla", "Found " + fileList.length + " files with extension .js, .jsm or .xhtml");
    let p = this.mapToBatch(
      fileList,
      (filePath) => this.getMatchesInFile(filePath, fixedStrings),
      2048
    );
    p = p.then(rv => {
      console.timeLog("mozilla", "Completed extracting contract lines");
      return rv.flat().filter(Boolean);
    });
    return p;
  },
};

async function findFilesContaining(pathToRepo, fixedStrings) {
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
    const contractLines = await DarwinTools.getAllContractLines(pathToRepo, fixedStrings);
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
      fixedStrings,
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
  return locationData;
}

module.exports = findFilesContaining;
