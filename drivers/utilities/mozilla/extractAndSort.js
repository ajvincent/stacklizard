"use strict";

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
  if (fileWithLine.startsWith("./"))
    fileWithLine = fileWithLine.substr(2);

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

module.exports = { extractLocations, sortLocations };
