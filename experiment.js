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
      ["object-define-this-match", 6],
      ["object-define-name-match", 6],
      ["object-define-name-mismatch", 6, 3],
      /*
      ["prototype-define", 26, 4],
      */
      /*
      ["prototype-assign", -2], // line number unclear
      */
    ].forEach(async function([testDir, lineNumber, ...debugLines]) {
      const pathToFile = path.join(process.cwd(), `fixtures/${testDir}/fixture.js`);
      const source = await fs.readFile(pathToFile, { encoding: "UTF-8" });

      const jsDriver = new JSDriver();

      jsDriver.appendSource("fixture.js", 1, source);
      console.log(testDir);
      console.log(jsDriver.serializeSourceMapping());

      if (testDir === debugDir)
        debugLines.forEach(line => jsDriver.debugByLine("fixture.js", line));

      jsDriver.parseSources();

      if (testDir === "object-define-name-mismatch") {
        const ignorable = jsDriver.nodeIndexByLineAndFilter(
          "fixture.js", 3, 0, n => n.type === "CallExpression"
        );
        jsDriver.markIgnored(ignorable);
      }

      const startAsync = jsDriver.functionNodeFromLine("fixture.js", lineNumber);
      const asyncRefs = jsDriver.getAsyncStacks(startAsync);

      console.log(serializer(startAsync, asyncRefs, jsDriver, {nested: true}));
    });
  }
})("object-define-name-mismatch");
