"use strict";

/**
 * @fileoverview
 *
 * @see https://firefox-source-docs.mozilla.org/build/buildsystem/jar-manifests.html
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Chrome_Registration
 */

const fs = require("fs").promises;
const util = require('util');
const path = require("path");
const execFile = util.promisify(require('child_process').execFile);

const contentBaseRE = /^%\s*content\s+(\S+)\s+(\S+)/;
const jarFileNameRE = /^([\w@-]+\.jar):\s*/;
const jarToLocalRE = /^([\w/_@-]+(?:\.\w+)?)(?:\s*\(%?([*./\w-]+(?:\.\w+)?)\))?/;
const bracketsRE = /^\[[^\]]+\]/;

const RegistryDriver = {
  overrides: new Map(/* originalURI: resolved URI */),

  fileMapping: new Map(/*
    "foo.jar!pathInJarFile": absolutePathToFile
  */),

  contentRegistration: new Map(/*
    "chrome://packagename/content/": "foo.jar!directoryInJarFile"
  */),

  chromeToLocalFiles: new Map(/*
    "chrome://packagename/content/foo/bar.js": absolutePathToFile
  */),

  ambiguousPackages: new Set(/*
    "chrome://packagename/content/"
  */),

  ambiguousJars: new Set(/*
    "foo.jar!directoryInJarFile"
  */),

  async getAllManifests(pathToRepo) {
    // find -type f -name jar.mn # this will get the list of jar files prepended by "./"
    let { stdout: jarManifestList } = await execFile(
      "find",
      [
        "-type",
        "f",
        "-name",
        "jar.mn",
      ],
      {
        cwd: pathToRepo,
        shell: true,
      }
    );

    const jarManifests = jarManifestList.split("\n");
    jarManifests.pop();
    await Promise.all(jarManifests.map(
      jarManifest => this.parseManifest(pathToRepo, jarManifest.substr(2))
    ));

    this.fillChromeToLocalFiles();
  },

  /*
  This file has no "% content" line in it.
  https://searchfox.org/mozilla-central/source/browser/components/preferences/jar.mn

browser.jar:
  content/browser/preferences/preferences.js

  This shows five files with the line
  "% content mozapps %content/mozapps/"
  https://searchfox.org/mozilla-central/search?q=%5E%25%5Cs%2Bcontent+mozapps&path=&case=false&regexp=true

toolkit.jar:
% content mozapps %content/mozapps/
  content/mozapps/update/history.xhtml                          (content/history.xhtml)

  This will require two extraction goals.  The first will map package names
  and content registrations to chrome://foo/content/ base URL's.  The second
  will map files within a directory, from their source to their target jar file
  and path within the jar.

  Then we have to weave the two together.

  find -type f -name jar.mn # this will get the list of jar files prepended by "./"
  */

  async parseManifest(pathToRepo, jarManifest) {
    const manifestLocation = path.resolve(pathToRepo, jarManifest);

    let currentJarFile = "";
    const lines = (await fs.readFile(manifestLocation, { encoding: "utf-8" })).split("\n");
    lines.pop();
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index].replace(bracketsRE, "").trim();
      if (line.startsWith("#") || line === "")
        continue;

      let match = jarFileNameRE.exec(line);
      if (match) {
        currentJarFile = match[1];
        continue;
      }

      if (!currentJarFile)
        throw new Error(`Expected a jar file in ${jarManifest} before line ${index + 1}`);
      if (currentJarFile === "@AB_CD@.jar")
        continue;

      if (line.startsWith("*"))
        line = line.substr(1).trim();

      if (line.startsWith("%")) {
        this.parsePercentLine(currentJarFile, line);
        continue;
      }

      match = jarToLocalRE.exec(line);
      if (match) {
        let items = Array.from(match).slice(1).filter(Boolean);
        let pathInJarFile = items[0];
        let pathToLocalFile = items[items.length - 1];
        if (items.length === 1) {
          pathToLocalFile = pathToLocalFile.substr(pathToLocalFile.lastIndexOf("/") + 1);
        }

        if (pathToLocalFile.includes("*")) {
          // not yet supported
          continue;
        }

        this.registerChromeFile(manifestLocation, currentJarFile, pathInJarFile, pathToLocalFile);
        continue;
      }

      throw new Error(`Unparseable line at ${jarManifest}:${index + 1}\n${line}`);
    }
  },

  parsePercentLine(currentJarFile, line) {
    let match = contentBaseRE.exec(line);
    if (!match) {
      return;
    }

    let [
      packageName,
      parameters
    ] = Array.from(match).slice(1);

    let chromeBase = `chrome://${packageName}/content/`, pathInJarFile = "";

    if (parameters[0] === "%") {
      pathInJarFile = parameters.substr(1);
    }
    const pathToJarLocation = `${currentJarFile}!${pathInJarFile}`;

    if (this.ambiguousPackages.has(chromeBase)) {
      this.ambiguousJars.add(pathToJarLocation);
      return;
    }

    if (this.contentRegistration.has(chromeBase)) {
      let current = this.contentRegistration.get(chromeBase);
      if (current !== pathToJarLocation) {
        this.ambiguousPackages.add(chromeBase);
        this.ambiguousJars.add(this.contentRegistration.get(chromeBase));
        this.ambiguousJars.add(pathToJarLocation);
        this.contentRegistration.delete(chromeBase);
        return;
      }
    }

    this.contentRegistration.set(chromeBase, pathToJarLocation);
  },

  registerChromeFile(manifestLocation, currentJarFile, pathInJarFile, relativePathToLocal) {
    const key = currentJarFile + "!" + pathInJarFile;
    const value = path.resolve(manifestLocation, "..", relativePathToLocal);
    this.fileMapping.set(key, value);
  },

  fillChromeToLocalFiles() {
    const baseDirs = Array.from(this.contentRegistration.entries());
    baseDirs.sort((a, b) => {
      if (a[1] === b[1])
        return 0;
      return a[1] < b[1] ? -1 : 1;
    });

    const files = Array.from(this.fileMapping.entries());
    files.sort((a, b) => {
      if (a[0] === b[0])
        return 0;
      return a[0] < b[0] ? -1 : 1;
    });

    const ambiguous = Array.from(this.ambiguousJars);
    files.forEach(currentFile => {
      for (let i = 0; i < ambiguous.length; i++) {
        if (currentFile[0].startsWith(ambiguous[i])) {
          return;
        }
      }

      for (let i = 0; i < baseDirs.length; i++) {
        const currentBase = baseDirs[i];
        if (currentFile[0].startsWith(currentBase[1])) {
          let chromePath = currentFile[0].replace(currentBase[1], currentBase[0]);
          this.chromeToLocalFiles.set(chromePath, currentFile[1]);
          return;
        }
      }
    });
  },
};


async function parseJarManifests(pathToRepo) {
  RegistryDriver.chromeToLocalFiles.clear();
  await RegistryDriver.getAllManifests(pathToRepo);
  return RegistryDriver.chromeToLocalFiles;
}

module.exports = parseJarManifests;
