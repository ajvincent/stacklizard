"use strict";

const path = require("path");
const filesByExtension = require("./filesByExtension");
const findFilesContaining = require("./findFilesContainingStrings");

const extractNameRE = /[`"'](?:resource|chrome):\/\/(?:[\w-]*\/)+([\w-]+\.jsm)['"`]/;

async function resourceModuleReferences(pathToRepo) {
  const jsmFiles = (await filesByExtension(pathToRepo, "jsm")).map(jsm => path.basename(jsm));
  jsmFiles.sort();

  const references = await findFilesContaining(
    pathToRepo, `"${jsmFiles.join("\n")}"`
  );

  const jsmMap = new Map(/* leafName: [ "resource://.../leafName" ] */);
  jsmFiles.forEach(jsm => jsmMap.set(jsm, []));

  references.forEach(ref => {
    const match = extractNameRE.exec(ref.source);
    if (!match) {
      return;
    }

    const name = match[1];
    if (!jsmMap.has(name)) {
      console.warn("couldn't find referenced JSM: " + name);
      return;
    }

    jsmMap.get(name).push(ref);

    ref.literal = match[0];
  });

  return jsmMap;
}

module.exports = resourceModuleReferences;
