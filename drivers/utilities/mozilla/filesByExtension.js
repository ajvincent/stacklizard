"use strict";

const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

const filesByExtensionMap = new Map(/* extension: string[] */);

async function getFiles(pathToRepo, extension) {
  // find -name *.jsm -type f
  let args = [
    ".",
    "-name",
    "*." + extension,
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
}

async function filesByExtension(pathToRepo, extension) {
  if (!filesByExtensionMap.has(extension)) {
    filesByExtensionMap.set(extension, await getFiles(pathToRepo, extension));
  }
  return filesByExtensionMap.get(extension);
}

module.exports = filesByExtension;
