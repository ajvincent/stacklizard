"use strict";
const assert = require("assert").strict;
const fs = require("fs").promises;
const path = require("path");
const EventEmitter = require("events");
const HTMLDriver = require("../lib/html");

it(
  "HTMLDriver correctly parses out relevant scripts and HTML references",
  async () => {
    const expectedSequence = [
      ["eventhandler",  3, 17, 'foo()'],
      ["inlinescript",  5, 15, '// he'],
      ["inlinescript", 10, 34, '\nfunc' ],
      ["loadscript",    0,  0, 'foo.j'],
      ["loadframe",     0,  0, 'foo.h'],
      ["loadframe",     0,  0, 'bar.h'],
    ];
  
    const actualSequence = [];
    const events = new EventEmitter;

    events.on("eventhandler", (name, location, attrValue) => {
      actualSequence.push([
        "eventhandler", location.line, location.column, attrValue.substr(0, 5)
      ]);
    });

    events.on("loadscript", (src) => {
      actualSequence.push([
        "loadscript", 0, 0, src.substr(0, 5)
      ]);
    });

    events.on("inlinescript", (location, contents) => {
      actualSequence.push([
        "inlinescript", location.line, location.column, contents.substr(0, 5)
      ]);
    });

    events.on("loadframe", (src) => {
      actualSequence.push([
        "loadframe", 0, 0, src.substr(0, 5)
      ]);
    });

    const driver = new HTMLDriver(events);

    const fullPath = path.join(process.cwd(), "fixtures/htmlDriver.html");
    const source = await fs.readFile(fullPath, { encoding: "UTF-8" } );
    driver.parseHTML(source);

    assert.deepEqual(actualSequence, expectedSequence);
  }
);
