"use strict";
const StackLizard = require("../stacklizard.js");
const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

async function fixtureTest(fixture) {
  const root = path.join(process.cwd(), "fixtures", fixture);
  const driver = StackLizard.buildDriver("javascript", root);

  let json = {};
  {
    const jsonSrc = await fs.readFile(
      path.join(root, "test-config.json"),
      { encoding: "utf-8" }
    );
    json = JSON.parse(jsonSrc);
  }

  if (Array.isArray(json.scripts)) {
    for (let i = 0; i < json.scripts.length; i++) {
      await driver.appendJSFile(json.scripts[i]);
    }
  }

  driver.parseSources();

  if (Array.isArray(json.ignore)) {
    json.ignore.map(ignore => {
      const ignorable = driver.nodeByLineFilterIndex(
        ignore.path,
        ignore.line,
        ignore.functionIndex,
        n => n.type === ignore.type
      );
      driver.markIgnored(ignorable);
    });
  }

  const startAsync = driver.functionNodeFromLine(
    json.markAsync.path,
    json.markAsync.line,
    json.markAsync.functionIndex
  );

  const asyncRefs = driver.getAsyncStacks(startAsync);

  const serializer = StackLizard.getSerializer("markdown");
  const analysis = serializer(startAsync, asyncRefs, driver, {nested: true});

  await fs.writeFile(
    path.join(root, "actual-callstack.txt"),
    analysis,
    { encoding: "utf-8" }
  );

  const expected = await fs.readFile(
    path.join(root, "expected-callstack.txt"),
    { encoding: "utf-8" }
  );

  assert.equal(analysis, expected);
}

describe(
  "JSDriver fixtures tests: ",
  function() {
    [
      "two-functions-minimal",
      "top-functions",
      "name-collision",
      "object-define-this-match",
      "object-define-name-match",
      "object-define-name-mismatch",
      "object-assign-this-match",
      "object-assign-name-match",
      "object-assign-name-mismatch",
      "object-this-getter",
      "prototype-define",
      "prototype-assign",
    ].forEach(
      fixture => it(fixture, async () => fixtureTest(fixture))
    );
  }
);

it ("JSDriver configuration-driven test", async function() {
  const pathToConfig = path.resolve(
    process.cwd(),
    "fixtures/object-define-name-mismatch/command-line-config.json"
  );
  const config = JSON.parse(await fs.readFile(pathToConfig));

  const rootDir = path.resolve(path.dirname(pathToConfig), config.driver.root);
  const parseDriver = StackLizard.buildDriver(
    config.driver.type,
    rootDir,
    config.driver.options || {}
  );

  const {startAsync, asyncRefs} = await parseDriver.analyzeByConfiguration(config.driver);

  const serializer = StackLizard.getSerializer(config.serializer.type);

  const analysis = serializer(
    startAsync, asyncRefs, parseDriver, config.serializer.options || {}
  );

  await fs.writeFile(
    path.join(rootDir, "actual-callstack.txt"),
    analysis,
    { encoding: "utf-8" }
  );

  const expected = await fs.readFile(
    path.join(rootDir, "expected-callstack.txt"),
    { encoding: "utf-8" }
  );

  assert.equal(analysis, expected);
});
