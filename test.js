"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  let ast = await lizard.parseJSFile("fixture.js");
  console.log(JSON.stringify(ast, null, 2));
})();
