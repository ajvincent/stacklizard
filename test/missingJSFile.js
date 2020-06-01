"use strict";
const StackLizard = require("../stacklizard.js");
const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

it("rejects noisily on a missing file", async function() {
  const lizard = new StackLizard("fixtures");
  let p = lizard.parseJSFile("404.js");
  p = p.then(() => assert.fail(), () => {});
  await p;
});
