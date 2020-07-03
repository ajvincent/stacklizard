#!/usr/bin/node

/**
 * @fileoverview
 * This file is to get all the contract IDs we can from Mozilla's build system
 * (specifically its components.conf files).
 */

const path = require('path');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

const pathToExtractor = path.resolve(__dirname, "extractListFrom.py");

var failedFiles = [];

/**
 * 
 * @param {string} pathToFile   The location of the Python file to parse.
 * @param {string} variableName The variable to extract.
 * @param {string} mode         The best mode to use for extracting the Python variable.
 */
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

/**
 * Get a list of XPCOM manifest files.
 * @param {string} pathToRepo The absolute path to the mozilla repository's local checkout.
 *
 * @returns {string[]} The list of files.
 */
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
      ],
      {
        cwd: pathToRepo,
        shell: true,
      }
    );

    mozBuildFiles = files.split("\n").filter(Boolean);
  }

  let fileLists = await Promise.all(mozBuildFiles.map(getXPCOMManifest));
  fileLists = fileLists.flat().filter(Boolean);
  fileLists.sort();
  return fileLists;
}

/**
 * Extract the components.conf file locations from a moz.build file..
 * @param {string} mozBuild The location of a moz.build file.
 *
 * @returns {string[]} Absolute paths to components.conf files.
 */
async function getXPCOMManifest(mozBuild) {
  if (!mozBuild) return [];
  let configurations = await extractListFromPython(mozBuild, "XPCOM_MANIFESTS", "substrings");

  const dir = path.dirname(mozBuild);
  return configurations.map(conf => path.resolve(dir, conf));
}

/**
 * Get XPCOM classes from a components.conf file.
 * @param {string} filePath The path to the components.conf file.
 *
 * @returns {Promise<Object[]>} The extracted XPCOM class data
 */
async function getClasses(filePath) {
  return extractListFromPython(filePath, "Classes", "substrings");
}

/**
 * Get all XPCOM classes in the repository (or as many as we can).
 * @param {string} pathToRepo The absolute path to the mozilla repository's local checkout.
 *
 * @returns {Promise<Object[]>} The extracted XPCOM class data
 */
async function getAllClasses(pathToRepo) {
  console.log("enter: Extracting XPCOM classes");
  failedFiles = [];
  const manifestFiles = await getManifestFiles(path.resolve(process.cwd(), pathToRepo));
  const classList = await Promise.all(manifestFiles.map(getClasses));
  let rv = classList.flat().filter(Boolean);

  failedFiles.sort();
  console.warn(`Failures: ${failedFiles.length}\n${JSON.stringify(failedFiles, null, 2)}`);
  console.log("gathered classes: " + rv.length);

  console.log("leave: Extracting XPCOM classes");
  return rv;
}

module.exports = getAllClasses;

if (require.main === module) {
  (async function() {
    console.log(JSON.stringify(await getAllClasses(process.argv[2]), null, 2));
  })();
}
