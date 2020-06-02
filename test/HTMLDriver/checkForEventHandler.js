"use strict";
const assert = require("assert").strict;
const LineAndColumn = require("../../lib/LineAndColumn");
const HTMLDriver = require("../../lib/html.js");

function assertJSONEqual(actual, expected, message = "") {
  assert.equal(
    JSON.stringify(actual),
    JSON.stringify(expected),
    message
  );
}

describe("HTMLDriver.prototype.checkForEventHandler", function() {
  let driver, current, scriptStart;
  const location = {
    line: 3,
    column: 5,
    url: ""
  };

  beforeEach(() => {
    driver = new HTMLDriver(() => {}, null);
    driver.locations = {
      current: new LineAndColumn,
      tagStart: new LineAndColumn,
      scriptStart: new LineAndColumn,
    };

    current = driver.locations.current;
    current.line = 3;
    current.column = 5;

    scriptStart = driver.locations.scriptStart;
  });

  it("ignores all characters when the eventState is 'none'", function() {

    driver.eventState = "none";

    Array.from("<c onload='d();'></c>").forEach(c => {
      driver.checkForEventHandler(c);
      assert.equal(driver.eventState, "none");
      assert.ok(scriptStart.isCleared, "");
      assertJSONEqual(current, location);
    });
  });

  it("ignores all characters when the eventState is 'processing'", function() {
    driver.eventState = "processing";

    Array.from("<c onload='d();'></c>").forEach(c => {
      driver.checkForEventHandler(c);
      assert.equal(driver.eventState, "processing");
      assert.ok(scriptStart.isCleared, "");
      assertJSONEqual(current, location);
    });
  });

  it("transitions correctly when the eventState is initially 'attrReady'", function() {
    driver.eventState = "attrReady";

    [
      ['\n', 'attrReady'],
      ['\t', 'attrReady'],
      [' ', 'attrReady'],
      ['o', 'o'],
      ['n', 'on'],
      ['a', 'onX'],
      ['b', 'onX'],
      ['=', 'onEvent='],
    ].forEach(([c, expected]) => {
      driver.checkForEventHandler(c);
      assert.equal(driver.eventState, expected, "on eating " + c);
      assert.ok(scriptStart.isCleared, "on eating " + c);
      assertJSONEqual(current, location);
    });

    current.column--;
    [
      ['"', 'processing'],
      ['d', 'processing'],
      ['(', 'processing'],
      [')', 'processing'],
      [';', 'processing'],
      ['"', 'processing'],
    ].forEach(([c, expected]) => {
      driver.checkForEventHandler(c);
      assert.equal(driver.eventState, expected, "on eating " + c);
      assertJSONEqual(scriptStart, location, "on eating " + c);
    });
  });

  // DFA tests
  describe("handles transitions for characters:", function() {
    let driver, current, scriptStart;
    const location = {
      line: 3,
      column: 5,
      url: ""
    };

    beforeEach(() => {
      driver = new HTMLDriver(() => {}, null);
      driver.locations = {
        current: new LineAndColumn,
        tagStart: new LineAndColumn,
        scriptStart: new LineAndColumn,
      };
  
      current = driver.locations.current;
      current.line = 3;
      current.column = 5;
  
      scriptStart = driver.locations.scriptStart;
    });

    [
      ['attrReady', ' ' , 'attrReady'],
      ['attrReady', '.', 'invalid'],
      ['attrReady', 'p', 'invalid'],
      ['attrReady', '\"', 'invalid'],
      ['attrReady', '\'', 'invalid'],
      ['attrReady', '=', 'invalid'],
      ['attrReady', 'O', 'o'],
      ['attrReady', 'o', 'o'],
      ['attrReady', 'N', 'invalid'],
      ['attrReady', 'n', 'invalid'],

      ['o', 'N', 'on'],
      ['o', 'n', 'on'],
      ['o', 'p', 'invalid'],
      ['o', '.', 'invalid'],
      ['o', '\"', 'invalid'],
      ['o', '\'', 'invalid'],
      ['o', '=', 'invalid'],

      ['on', ' ', 'invalid'],
      ['on', '=', 'invalid'],
      ['on', 'p', 'onX'],
      ['on', '.', 'invalid'],

      ['onX', ' ', 'onX+whitespace'],
      ['onX', '.', 'invalid'],
      ['onX', 'p', 'onX'],
      ['onX', '\"', 'invalid'],
      ['onX', '\'', 'invalid'],
      ['onX', '=', 'onEvent='],

      ['onX+whitespace', ' ', 'onX+whitespace'],
      ['onX+whitespace', '=', 'onEvent='],
      ['onX+whitespace', 'o', 'invalid'],
      ['onX+whitespace', '\"', 'invalid'],
      ['onX+whitespace', '\'', 'invalid'],
      ['onX+whitespace', '.', 'invalid'],

      ['onEvent=', ' ', 'onEvent='],
      ['onEvent=', '.', 'invalid'],
      ['onEvent=', 'o', 'invalid'],
      ['onEvent=', '\"', 'processing'],
      ['onEvent=', '\'', 'processing'],
    ].forEach(
      ([start, c, expected], index) => {
        it(`${start}, \`${c}\` -> ${expected}`, function() {
          driver.eventState = start;
          driver.checkForEventHandler(c);
          assert.equal(driver.eventState, expected);
          assertJSONEqual(current, location);
          assert.ok(
            scriptStart.isCleared !== (
              (start == "onEvent=") && (expected == "processing")
            )
          );
        });
      }
    );
  });
});

