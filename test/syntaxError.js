"use strict";
const StackLizard = require("../stacklizard.js");
const assert = require("assert");

it("rejects noisily on a syntax error", async function() {
  const driver = StackLizard.buildDriver("javascript", "fixtures");
  await driver.appendJSFile("syntaxError.js");

  let pass = true;
  try {
    driver.parseSources();
    pass = false;
  }
  catch (ex) {
    // do nothing
  }
  assert.ok(pass, "parseSources should've thrown on a syntax error");
});
