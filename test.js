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
})();
