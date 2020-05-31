"use strict";

const StackLizard = require("../stacklizard.js");
const assert = require("assert");

async function fixtureTest(fixture) {
  const root = "fixtures/" + fixture;
  const lizard = new StackLizard(root);
  const pathToFile = "fixture.js";
  await lizard.parseJSFile(pathToFile);
  lizard.populateMaps(pathToFile);

  const stacks = lizard.getStacksOfFunction(pathToFile, 26);
  const analysis = lizard.serializeAnalysis(stacks);

  const fs = require("fs").promises;
  const path = require("path");
  await fs.writeFile(
    path.join(process.cwd(), root + "/actual-callstack.txt"),
    analysis
  );

  const expected = await fs.readFile(
    path.join(process.cwd(), root + "/expected-callstack.txt"),
    { encoding: "ascii" }
  );

  assert.equal(analysis, expected);
}

describe("Fixtures tests: ", function() {
  [
    "single-file",
  ].forEach(fixture => it(fixture, async () => fixtureTest(fixture)));
});

/* TODO:
 * npm install htmlparser2@3.10.1 # sax-like htmlparser Mozilla uses
 */
