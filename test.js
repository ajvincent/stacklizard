"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  const pathToFile = "fixture.js";
  await lizard.parseJSFile(pathToFile);
  lizard.populateMaps(pathToFile);

  const stacks = lizard.getStacksOfFunction(pathToFile, 26);
  const analysis = lizard.serializeAnalysis(stacks);

  const fs = require("fs").promises;
  const path = require("path");
  await fs.writeFile(
    path.join(process.cwd(), "fixtures/single-file/actual-callstack.txt"),
    analysis
  );

  const expected = await fs.readFile(
    path.join(process.cwd(), "fixtures/single-file/expected-callstack.txt"),
    { encoding: "ascii" }
  );
  const expectedLines = expected.split("\n"),
        actualLines   = analysis.split("\n");

  const lineCount = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < lineCount; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      throw new Error(`Line mismatch in fixtures/single-file, line ${i + 1}:\n-${expectedLines[i]}\n+${actualLines[i]}\n`);
    }
  }
})();

/* TODO:
 * npm install --save-dev mocha@7.1.0 # test framework Mozilla uses for eslint-plugin-mozilla
 * npm install htmlparser2@3.10.1 # sax-like htmlparser Mozilla uses
 */
