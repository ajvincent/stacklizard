"use strict";

const StackLizard = require("./stacklizard.js");

(async function() {
  const lizard = new StackLizard("fixtures/single-file");
  await lizard.parseJSFile("fixture.js");
  const functionNode = lizard.functionNodeFromLine("fixture.js", 19);
  const ancestors = lizard.ancestorMap.get(functionNode);
  const propData = lizard.definedOn(ancestors);
  const methodNodes = lizard.nodesCallingMethodSync(
    "this",
    "method",
    propData.name,
    propData.directParentNode,
    propData.node,
    ""
  );
  console.log(methodNodes);
})();
