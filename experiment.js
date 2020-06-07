#!/usr/bin/env node
"use strict";

const fs = require("fs").promises;
const path = require("path");
const JSDriver = require("./drivers/javascript");
const serializer = require("./serializers/markdown");

(async function(debugDir) {
  if (true) {
    const basePath = path.join(process.cwd(), "fixtures/two-functions-minimal/");
    async function getFile(pathToFile) {
      return fs.readFile(path.join(basePath, pathToFile), { encoding: "UTF-8" });
    }

    const jsDriver = new JSDriver();
  
    jsDriver.appendSource("a.js", 1, (await getFile("a.js")));
    jsDriver.appendSource("b.js", 1, (await getFile("b.js")));
    console.log(jsDriver.serializeSourceMapping());

    if (debugDir === "two-functions-minimal")
      debugger;
    jsDriver.parseSources();
  
    const startAsync = jsDriver.functionNodeFromLine("b.js", 1);
    const asyncRefs = jsDriver.getAsyncStacks(startAsync);
  
    console.log(serializer(startAsync, asyncRefs, jsDriver, {nested: true}));
  }

  if (true) {
    await [
      ["top-functions", 19],
      ["name-collision", 9],
      /*
      ["prototype-define", 26],
      ["prototype-assign", -2], // line number unclear
      */
    ].forEach(async function([testDir, lineNumber, ...debugLines]) {
      const pathToFile = path.join(process.cwd(), `fixtures/${testDir}/fixture.js`);
      const source = await fs.readFile(pathToFile, { encoding: "UTF-8" });

      const jsDriver = new JSDriver();

      jsDriver.appendSource("fixture.js", 1, source);
      console.log(jsDriver.serializeSourceMapping());

      if (testDir === debugDir)
        debugLines.forEach(line => jsDriver.debugByLine("fixture.js", line));

      jsDriver.parseSources();

      const startAsync = jsDriver.functionNodeFromLine("fixture.js", lineNumber);
      const asyncRefs = jsDriver.getAsyncStacks(startAsync);

      console.log(serializer(startAsync, asyncRefs, jsDriver, {nested: true}));
    });
  }
})("prototype-define");
