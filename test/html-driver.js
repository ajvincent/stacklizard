"use strict";
const HTMLParseDriver = require("../drivers/html");
const assert = require("assert");
//const fs = require("fs").promises;
const path = require("path");

describe("HTML driver's", function() {
  describe("resolveURI() method", function() {
    const jobBaseDir = "fixtures/directory-structure";
    let driver;
    beforeEach(() => driver = new HTMLParseDriver(jobBaseDir, {}));

    it("goes from a directory to a child correctly", function() {
      const expected = "b/b.js";
      const actual = driver.resolveURI("b/", "b.js");
      assert.equal(actual, expected);
    });

    it("goes from a directory to a sibling file correctly", function() {
      const expected = "a";
      const actual = driver.resolveURI("b/", "../a");
      assert.equal(actual, expected);
    });

    it("goes from a directory to a nephew file correctly", function() {
      const expected = "a/a.js";
      const actual = driver.resolveURI("b/", "../a/a.js");
      assert.equal(actual, expected);
    });

    it("disallows jumping out of the sandbox", function() {
      const expected = "";
      const actual = driver.resolveURI("b/", "../../top-functions/fixture.js");
      assert.equal(actual, expected);
    });

    it("will let someone clever drop back into the sandbox", function() {
      const expected = "a/a.js";
      const actual = driver.resolveURI("b/", "../../directory-structure/a/a.js");
      assert.equal(actual, expected);
    });
  });
});
