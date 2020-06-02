"use strict";
const StackLizard = require("../stacklizard.js");
const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

async function fixtureTest(fixture) {
  const root = "fixtures/" + fixture;
  const lizard = new StackLizard(root);

  let json = {};
  {
    const jsonSrc = await fs.readFile(
      path.join(process.cwd(), root, "test-config.json"),
      { encoding: "utf-8" }
    );
    json = JSON.parse(jsonSrc);
  }

  if (Array.isArray(json.scripts)) {
    await Promise.all(json.scripts.map(async path => lizard.parseJSFile(path)));
    json.scripts.forEach(path => lizard.populateMaps(path));
  }

  const stackList = json.markAsync.map(params => lizard.getStacksOfFunction(
    params.path,
    params.line,
    params.functionIndex
  ));
  const analysis = lizard.serializeAnalysis.apply(lizard, stackList);

  await fs.writeFile(
    path.join(process.cwd(), root, "actual-callstack.txt"),
    analysis,
    { encoding: "utf-8" }
  );

  const expected = await fs.readFile(
    path.join(process.cwd(), root, "expected-callstack.txt"),
    { encoding: "utf-8" }
  );

  assert.equal(analysis, expected);
}

describe("Fixtures tests: ", function() {
  [
    "single-file",
  ].forEach(fixture => it(fixture, async () => fixtureTest(fixture)));
});
