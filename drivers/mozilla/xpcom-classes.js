#!/usr/bin/node
const path = require('path');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

const pathToExtractor = path.join(process.cwd(), "drivers/mozilla/extractListFrom.py");

var failedFiles = [];

async function extractListFromPython(pathToFile, variableName, mode) {
  const args = [pathToFile, variableName, mode];
  try {
    let { stdout } = await execFile(pathToExtractor, args);
    return JSON.parse(stdout);
  }
  catch (ex) {
    failedFiles.push(pathToFile);
    return [];
  }
}

async function getManifestFiles(pathToRepo) {
  let mozBuildFiles;
  {
    const { stdout: files } = await execFile(
      "grep",
      [
        "--include=moz.build",
        "--color=never",
        "-rl",
        "XPCOM_MANIFESTS",
        pathToRepo
      ]
    );

    mozBuildFiles = files.split("\n").filter(Boolean);
  }

  let fileLists = await Promise.all(mozBuildFiles.map(getXPCOMManifest));
  fileLists = fileLists.flat().filter(Boolean);
  fileLists.sort();
  return fileLists;
}

async function getXPCOMManifest(mozBuild) {
  if (!mozBuild) return [];
  let configurations = await extractListFromPython(mozBuild, "XPCOM_MANIFESTS", "substrings");

  const dir = path.dirname(mozBuild);
  return configurations.map(conf => path.join(dir, conf));
}

async function getClasses(filePath) {
  return extractListFromPython(filePath, "Classes", "substrings");
}

async function getAllClasses(pathToRepo) {
  failedFiles = [];
  const manifestFiles = await getManifestFiles(path.join(process.cwd(), pathToRepo));
  const classList = await Promise.all(manifestFiles.map(getClasses));
  return classList.flat().filter(Boolean);
}

module.exports = getAllClasses;

if (require.main === module) {
  (async function() {
    console.log(JSON.stringify(await getAllClasses("../mozilla-central"), null, 2));

    failedFiles.sort();
    console.warn(`Failures: ${failedFiles.length}\n${JSON.stringify(failedFiles, null, 2)}`);
  })();
}
