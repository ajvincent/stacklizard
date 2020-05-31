"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  await lizard.parseJSFile("fixture.js");

  const stacks = lizard.getStacksOfFunction("fixture.js", 26);

  const analysis = lizard.serializeAnalysis(stacks);

  const fs = require("fs").promises;
  const path = require("path");
  await fs.writeFile(
    path.join(process.cwd(), "fixtures/single-file/actual-callstack.txt"),
    analysis
  );
})();
