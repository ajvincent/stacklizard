#!/usr/bin/node
"use strict";
const util = require('util');
const path = require("path");
const execFile = util.promisify(require('child_process').execFile);

const grepRE = /^([^:]+):([^:]+):/;

function extractLocations(fileWithLine, prefixLength) {
  if (!fileWithLine)
    return null;
  const matches = grepRE.exec(fileWithLine);
  if (!matches) {
    console.error(fileWithLine);
    throw new Error("No match found for fileWithLine");
  }
  const parts = Array.from(matches);
  return {
    path: parts[1].substr(prefixLength),
    line: parseInt(parts[2], 10)
  };
}

async function getChromeXHTML(pathToRepo, prefixLength, jsPath) {
  let filesWithLine = "";
  try {
    let results = await execFile(
      "grep",
      [
        "--include=*.xhtml",
        "--color=never",
        "-rn",
        `"${path.basename(jsPath)}"`,
        pathToRepo
      ],
      {
        shell: true,
      }
    );
    filesWithLine = results.stdout;
  }
  catch (ex) {
    // do nothing, this is expected to happen
  }

  filesWithLine = filesWithLine.trim().split("\n");

  return filesWithLine.map(fileWithLine => extractLocations(fileWithLine, prefixLength));
}

async function getLiteralLocations(pathToRepo, literal) {
  const literalAsJSON = JSON.stringify(literal);
  let filesWithLine = "";
  try {
    let results = await execFile(
      "grep",
      [
        "--include=*.js",
        "--include=*.jsm",
        "--include=*.h",
        "--include=*.cpp",
        "--color=never",
        "-rn",
        literalAsJSON,
        pathToRepo
      ],
      { shell: true }
    );
    filesWithLine = results.stdout;
  }
  catch (ex) {
    // do nothing, this is expected to happen
  }

  let prefixLength = pathToRepo.length;
  if (!pathToRepo.endsWith("/"))
    prefixLength++;

  async function getLineSources(fileWithLine) {
    let rv = extractLocations(fileWithLine, prefixLength);

    if (rv.path.endsWith(".js")) {
      // maybe it's a chrome:// JS file
      rv = (await getChromeXHTML(pathToRepo, prefixLength, rv.path)) || rv;
    }

    return rv;
  }

  /*
  let locations = await Promise.all(filesWithLine.split("\n").map(async fileWithLine => {
  }));
  */
  filesWithLine = filesWithLine.trim().split("\n");
  let locations = [];
  for (let i = 0; i < filesWithLine.length; i++) {
    const fileWithLine = filesWithLine[i];
    locations.push(await getLineSources(fileWithLine));
  }

  return locations.flat().filter(Boolean);
}

module.exports = getLiteralLocations;
