"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  await lizard.parseJSFile("fixture.js");

  const stacks = lizard.getStacksOfFunction("fixture.js", 26);
  console.log(lizard.serializeAnalysis(stacks));
})();
