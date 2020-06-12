"use strict";
const StackLizard = require("../stacklizard.js");
const assert = require("assert");

it("rejects noisily on a missing file", async function() {
  const driver = StackLizard.buildDriver("javascript", "fixtures");
  let p = driver.appendJSFile("404.js");
  p = p.then(() => assert.fail(), () => {});
  await p;
});
