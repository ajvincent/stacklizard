"use strict";
const StackLizard = require("../stacklizard");
const HTMLParseDriver = require("../drivers/html");
const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

async function fixtureTest_HTML(fixture) {
  const root = path.resolve(process.cwd(), "fixtures", fixture);
  const driver = StackLizard.buildDriver("html", root);

  let json = {};
  {
    const jsonSrc = await fs.readFile(
      path.resolve(root, "test-config.json"),
      { encoding: "utf-8" }
    );
    json = JSON.parse(jsonSrc);
  }

  await driver.appendSourcesViaHTML(json.pathToHTML);

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

  const serializer = StackLizard.getSerializer(
    "markdown", startAsync, asyncRefs, driver, {nested: true}
  );
  const analysis = serializer.serialize();

  await fs.writeFile(
    path.resolve(root, "actual-callstack.txt"),
    analysis,
    { encoding: "utf-8" }
  );

  const expected = await fs.readFile(
    path.resolve(root, "expected-callstack.txt"),
    { encoding: "utf-8" }
  );

  assert.equal(analysis, expected);
}

describe("HTMLParseDriver", function() {
  describe("resolveURI()", function() {
    const jobBaseDir = "fixtures/directory-structure";
    let driver;
    beforeEach(() => driver = new HTMLParseDriver(jobBaseDir, {}));

    it("goes from a directory to a child correctly", function() {
      const expected = "b/b.js";
      const actual = driver.resolveURI("b/", "b.js");
      assert.equal(actual, expected);
    });

    it("goes from a directory to a sibling file correctly", function() {
      const expected = "a";
      const actual = driver.resolveURI("b/", "../a");
      assert.equal(actual, expected);
    });

    it("goes from a directory to a nephew file correctly", function() {
      const expected = "a/a.js";
      const actual = driver.resolveURI("b/", "../a/a.js");
      assert.equal(actual, expected);
    });

    it("disallows jumping out of the sandbox", function() {
      const actual = driver.resolveURI("b/", "../../top-functions/fixture.js");
      assert.equal(typeof actual, "symbol");
    });

    it("will let someone clever drop back into the sandbox", function() {
      const expected = "a/a.js";
      const actual = driver.resolveURI("b/", "../../directory-structure/a/a.js");
      assert.equal(actual, expected);
    });
  });

  describe("fixtures tests", function() {
    [
      "directory-structure",
    ]
    .forEach(
      fixture => it(fixture, async () => fixtureTest_HTML(fixture))
    );
  });
});
