"use strict";
const htmlparser2 = require("htmlparser2");
const fs = require("fs").promises;
const path = require("path");
const LineAndColumn = require("./LineAndColumn");

const parseOptions = {
  lowerCaseTags: true,
  decodeEntities: true,
  lowerCaseAttributeNames: true,
  recognizeSelfClosing: true,
};

function isJavaScriptElement(name, attribs = {}) {
  if (name !== "script")
    return false;

  if (("type" in attribs) &&
      !/^(application|text)\/(x-)?javascript(;version=.)?$/.test(attribs.type)) {
    return false;
  }

  return true;
}

function HTMLDriver(urlResolver, stackLizard) {
  this.urlResolver = urlResolver;
  this.stackLizard = stackLizard;
}

HTMLDriver.prototype.parseHTMLFiles = async function(pathToStartHTML) {
  this.recording = false;
  this.buffer = "";

  this.scriptFiles = new Map(/* LineAndColumn: string */);
  this.htmlFiles = [pathToStartHTML];

  for (let i = 0; i < this.htmlFiles.length; i++) {
    this.currentHTML = this.htmlFiles[i];
    const fullPath = path.join(process.cwd(), this.stackLizard.rootDir, this.currentHTML);
    const source = await fs.readFile(fullPath, { encoding: "UTF-8" } );
    const lines = source.split("\n");

    this.parseHTML(lines);
  }

  this.htmlFiles = null;
};

HTMLDriver.prototype.parseHTML = function(lines) {
  const parser = new htmlparser2.parser(this, parseOptions);

  this.locations = {
    current: new LineAndColumn,
    tagStart: new LineAndColumn,
    scriptStart: new LineAndColumn,
  };
  this.eventState = "none";

  lines.forEach((line, index) => {
    this.locations.current.line++;

    // looking for event handlers on elements before feeding to parser
    Array.from(line).forEach((c, i) => {
      this.locations.current.column = i;
      this.checkForEventHandler(c);
      parser.write(c);
    });

    this.locations.current.column++;
    parser.write('\n');
  });

  parser.end();
};

HTMLDriver.prototype.checkForEventHandler = function(c) {
  switch (this.eventState) {
    case "attrReady":
      if ((c === 'o') || (c === 'O'))
        this.eventState = "o";
      else if (/\S/.test(c))
        this.eventState = "invalid";
      break;

    case "o":
      if ((c === 'n') || (c === 'N'))
        this.eventState = "on";
      else
        this.eventState = "invalid";
      break;

    case "on":
      c = c.toLowerCase();
      if (('a' <= c) && (c <= 'z'))
        this.eventState = "onX";
      else
        this.eventState = "invalid";
      break;

    case "onX":
      c = c.toLowerCase();
      if (c === "=")
        this.eventState = "onEvent=";
      else if (('a' <= c) && (c <= 'z')) {
        // do nothing
      }
      else if (/\s/.test(c))
        this.eventState = "onX+whitespace";
      else
        this.eventState = "invalid";
      break;

    case "onX+whitespace":
      c = c.toLowerCase();
      if (c === "=")
        this.eventState = "onEvent=";
      else if (/\s/.test(c)) {
        // do nothing
      }
      else
        this.eventState = "invalid";
      break;

    case "onEvent=":
      if ((c === "'") || (c === '"')) {
        this.eventState = "processing";
        this.locations.scriptStart.copy(this.locations.current);
        this.locations.scriptStart.column++;
      }
      else if (/\s/.test(c)) {
        // do nothing
      }
      else
        this.eventState = "invalid";
      break;
    default:
      // do nothing
  }
};

HTMLDriver.prototype.onopentag = function(name, attribs) {
  this.locations.tagStart.clear();
  this.locations.attrStart.clear();
  this.eventState = "none";

  if (attribs.src) {
    if ((name === "frame") || (name === "iframe")) {
      this.scheduleLoadFrame(attribs.src);
    }
    if (isJavaScriptElement(name, attribs)) {
      this.scheduleJSFile(attribs.src);
    }
  }
  else if (isJavaScriptElement(name)) {
    this.recording = true;
    this.buffer = "";
    this.eventState = "suspended";
  }
};

HTMLDriver.prototype.onopentagname = function(/* name */) {
  this.eventState = "attrReady";
};

HTMLDriver.prototype.onclosetag = function(name) {
  this.locations.tagStart.clear();
  if (this.recording && (name === "script")) {
    this.scheduleJSInline({
      value: this.scriptBuffer,
      start: new LineAndColumn(this.locations.scriptStart),
    });
    this.locations.scriptStart.clear();
  }
  this.recording = false;
  this.eventState = "none";
};

HTMLDriver.prototype.oncomment =
HTMLDriver.prototype.ontext = function(text) {
  if (!this.recording)
    return;

  if (this.locations.scriptStart.isCleared)
    this.locations.scriptStart.copy(this.locations.current);

  this.buffer += text;
};

HTMLDriver.prototype.onattribute = function(name, value) {
  const isEventHandler = this.eventState === "processing";
  this.eventState = "attrReady";

  let start = new LineAndColumn(this.locations.scriptStart);
  this.locations.scriptStart.clear();

  if (!isEventHandler)
    return;

  this.eventState = "suspended";
  this.scheduleJSInline({name, value, start});
};

HTMLDriver.prototype.scheduleLoadFrame = function(path) {
  throw new Error("not implemented");
};

HTMLDriver.prototype.scheduleJSFile = function(path) {
  throw new Error("not implemented");
};

HTMLDriver.prototype.scheduleJSInline = function(metadata) {
  throw new Error("not implemented");
};

HTMLDriver.prototype.parseScripts = async function() {
  throw new Error("not implemented");
};

module.exports = HTMLDriver;
