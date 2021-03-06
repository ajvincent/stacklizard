"use strict"
const htmlparser2 = require("htmlparser2");
const EventEmitter = require("events");

function wrapTokenizerAttrStart(name) {
  const _method = htmlparser2.Tokenizer.prototype[name];
  this.parser._tokenizer[name] = (...args) => {
    if (!this.inAttribute) {
      this.inAttribute = true;
      this.textLocation.copy(this.location);
    }

    return _method.apply(this.parser._tokenizer, args);
  };
}

const parseOptions = {
  lowerCaseTags: true,
  decodeEntities: true,
  recognizeSelfClosing: true,
};

function LineAndColumn(other = null) {
  other ? this.copy(other) : this.clear();
}
{
  LineAndColumn.prototype.copy = function(other) {
    this.line = other.line;
    this.column = other.column;
    this.url = other.url;
  };
  
  LineAndColumn.prototype.clear = function() {
    this.line = 0;
    this.column = 0;
    this.url = "";
  };
  
  LineAndColumn.prototype.toString = function() {
    return `at line ${this.line} column ${this.column}`;
  };
  
  Reflect.defineProperty(LineAndColumn.prototype, "isCleared", {
    get: function() { return (this.line === 0); },
    enumerable: true,
    configurable: false,
  });
}

class ScriptExtractor {
  constructor(events = new EventEmitter) {
    this.parser = new htmlparser2.Parser(this, parseOptions);
    [
      "_stateInAttributeValueDoubleQuotes",
      "_stateInAttributeValueSingleQuotes",
      "_stateInAttributeValueNoQuotes",
    ].forEach(wrapTokenizerAttrStart, this);

    this.lines = null;

    this.location = new LineAndColumn();
    this.textLocation = new LineAndColumn();
    this.inAttribute = false;
    this.textBuffer = "";

    this.lineTracing = false;

    this.events = events;
  }

  parseHTML(htmlSource) {
    this.lines = htmlSource.split("\n");

    this.lines.forEach((line, lineIndex) => {
      this.location.line = lineIndex + 1;

      if (this.lineTracing) {
        console.log(`${line}`);
        let mark = line.replace(/./g, ".") + ".";
        mark = mark.replace(/\.{5}/g, "....^");
        console.log(`${mark} ${this.location.line}`);
      }

      Array.from(line + '\n').forEach((c, i) => {
        this.location.column = i + 1;
        this.parser.write(c);
      });
    });

    this.parser.end();
  }

  isJavaScriptElement(name, attribs = {}) {
    if (name !== "script")
      return false;

    if (("type" in attribs) &&
        !/^(application|text)\/(x-)?javascript(;version=.)?$/.test(attribs.type)) {
      return false;
    }

    return true;
  }

  isFrameElement(name, attribs) {
    return ("src" in attribs) && /^i?frame$/.test(name);
  }

  flushText() {
    let rv = this.textBuffer;
    if (this.textBuffer) {
      this.textBuffer = "";
    }
    return rv;
  }

  onattribute(name, value) {
    this.inAttribute = false;
    if (/^on./i.test(name))
      this.events.emit("eventhandler", name, new LineAndColumn(this.textLocation), value);
  }

  onopentag(name, attribs) {
    if (this.isJavaScriptElement(name, attribs)) {
      if (attribs.src) {
        this.events.emit("loadscript", attribs.src);
      }
      else {
        this.isInlineScript = true;
      }

      this.ontext('');
    }
    else if (this.isFrameElement(name, attribs))
      this.events.emit("loadframe", attribs.src);
    else if ((name === "base") && (attribs.href))
      this.events.emit("baseHref", attribs.href);
  }

  onopentagname(/* name */) {
    this.flushText();
  }

  oncomment(/* contents */) {
    this.flushText();
  }

  ontext(c) {
    if (!this.textBuffer)
      this.textLocation.copy(this.location);
    this.textBuffer += c;
  }

  onclosetag(/* name */) {
    let contents = this.flushText();
    if (this.isInlineScript) {
      if (contents.startsWith("<!--")) {
        this.textLocation.column += 3;
        contents = contents.substring(4, contents.length - 4);
      }

      this.events.emit("inlinescript", new LineAndColumn(this.textLocation), contents);
      this.isInlineScript = false;
    }
  }
}

module.exports = ScriptExtractor;
