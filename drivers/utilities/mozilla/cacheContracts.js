"use strict";
const util = require('util');
const path = require("path");
const execFile = util.promisify(require('child_process').execFile);

const grepRE = /^([^:]+):([^:]+):/;

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

async function cacheContracts(pathToRepo, classData) {
  const contracts = classData.map(d => d.contract_ids).filter(Boolean).flat();
  contracts.sort();

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

  contracts.forEach(c => {
    const row = [];
    results.set(c, row);
    for (let i = locationData.length - 1; i--; i >= 0) {
      const data = locationData[i];
      if (!data.source.includes(c)) {
        continue;
      }

      row.unshift(data);
      locationData.splice(i, 1);

      if (data.path.endsWith(".js")) {
        const leaf = "/" + path.basename(data.path);
        if (!jsFiles.has(leaf))
          jsFiles.set(leaf, []);
        jsFiles.get(leaf).push(data);
      }
    }
  });

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

  jsFileKeys.forEach(leaf => {
    const row = jsFiles.get(leaf);
    for (let i = xhtmlData.length - 1; i--; i >= 0) {
      const xhtmlEntry = xhtmlData[i];
      if (!xhtmlEntry.source.includes(leaf)) {
        continue;
      }

      xhtmlData.splice(i, 1);

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
