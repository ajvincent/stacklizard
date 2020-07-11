"use strict";
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

const { extractLocations, sortLocations } = require("./extractAndSort");

/**
 * @param {string} pathToRepo The absolute path to the mozilla repository's local checkout.
 * @param {Map}    jsFiles leafName: extracted locations
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

module.exports = findHTMLFilesLoadingJS;