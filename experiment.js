#!/usr/bin/env node
"use strict";

const fs = require("fs").promises;
const path = require("path");
const JSDriver = require("./drivers/javascript");
const serializer = require("./serializers/markdown");

async function simpleFixtureTest(debugDir, [testDir, lineNumber, ...debugLines]) {
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
    const ignorable = jsDriver.nodeByLineFilterIndex(
      "fixture.js", 3, 0, n => n.type === "CallExpression"
    );
    jsDriver.markIgnored(ignorable);
  }
  if (testDir === "object-assign-name-mismatch") {
    const ignorable = jsDriver.nodeByLineFilterIndex(
      "fixture.js", 3, 0, n => n.type === "CallExpression"
    );
    jsDriver.markIgnored(ignorable);
  }

  const startAsync = jsDriver.functionNodeFromLine("fixture.js", lineNumber);

  if (testDir === debugDir)
    debugger;
  const asyncRefs = jsDriver.getAsyncStacks(startAsync);

  console.log(serializer(startAsync, asyncRefs, jsDriver, {nested: true}));
}

(async function(debugDir) {
  try {
    const basePath = path.join(process.cwd(), "fixtures/two-functions-minimal/");
    async function getFile(pathToFile) {
      return fs.readFile(path.join(basePath, pathToFile), { encoding: "UTF-8" });
    }

    const jsDriver = new JSDriver();

    jsDriver.appendSource("a.js", 1, (await getFile("a.js")));
    jsDriver.appendSource("b.js", 1, (await getFile("b.js")));
    console.log(jsDriver.serializeSourceMapping());

    if (debugDir === "two-functions-minimal") {
      jsDriver.debugByLine("a.js", 1);
    }
    jsDriver.parseSources();

    const startAsync = jsDriver.functionNodeFromLine("b.js", 1);

    if (debugDir === "two-functions-minimal") {
      debugger;
    }
    const asyncRefs = jsDriver.getAsyncStacks(startAsync);

    console.log(serializer(startAsync, asyncRefs, jsDriver, {nested: true}));
  }
  catch (ex) {
    console.error("In two-functions-minimal");
    throw ex;
  }

  if (true) {
    await Promise.all([
      ["top-functions", 19],
      ["name-collision", 9],
      ["object-define-this-match", 6, 3],
      ["object-define-name-match", 6],
      ["object-define-name-mismatch", 6],
      ["object-assign-this-match", 6, 6],
      ["object-assign-name-match", 6],
      ["object-assign-name-mismatch", 6],
      ["object-this-getter", 10, 3, 6],
      /*
      ["prototype-define", 26, 15],
      ["prototype-assign", -2], // line number unclear
      */
    ].map(async data => {
      try {
        const output = await simpleFixtureTest(debugDir, data);
        return output;
      }
      catch (ex) {
        console.error("In data.testDir");
        throw ex;
      }
    }));
  }
})("object-this-getter");
