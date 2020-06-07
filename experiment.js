#!/usr/bin/env node
"use strict";

const fs = require("fs").promises;
const path = require("path");
const JSDriver = require("./drivers/javascript");

(async function() {
  const basePath = path.join(process.cwd(), "fixtures/two-functions-minimal/");
  async function getFile(pathToFile) {
    return fs.readFile(path.join(basePath, pathToFile), { encoding: "UTF-8" });
  }

  const jsDriver = new JSDriver();

  jsDriver.appendSource("a.js", 1, (await getFile("a.js")));
  jsDriver.appendSource("b.js", 1, (await getFile("b.js")));
  console.log(jsDriver.serializeSourceMapping());

  jsDriver.parseSources();

  const startAsync = jsDriver.functionNodeFromLine("b.js", 1);
  const asyncRefs = jsDriver.getAsyncStacks(startAsync);

  {
    console.log(`- ${startAsync.id.name}() async ${jsDriver.fileAndLine(startAsync)}`);
    const [{ awaitNode, asyncNode }] = asyncRefs.get(startAsync);
    console.log(`  - ${asyncNode.id.name}() await ${jsDriver.fileAndLine(awaitNode)}, async ${jsDriver.fileAndLine(asyncNode)}`);
  }

  return null;
})();
