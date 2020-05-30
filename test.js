"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  await lizard.parseJSFile("fixture.js");
  const ancestors = lizard.ancestorsJS("fixture.js", 19);
  console.log(ancestors);
})();
