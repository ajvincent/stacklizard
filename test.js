"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  await lizard.parseJSFile("fixture.js");

  const methodNodes = lizard.getStacksOfFunction("fixture.js", 19);
  console.log(methodNodes.map(n => {
    const parent = lizard.ancestorMap.get(n)[1];
    return {
      name: parent.key.name,
      line: n.loc.start.line,
      column: n.loc.start.column,
    };
  }));
})();
