"use strict"
const htmlparser2 = require("htmlparser2");
const LineAndColumn = require("./LineAndColumn");

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

class HTMLDriver {
  constructor(cbs = {
    oneventhandler: (name, location, source) => null,
    oninlinescript: (location, source) => null,
    onloadscript: (url) => null,
    onloadframe: (url) => null
  }) {
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

    this._cbs = cbs;
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
      this._cbs.oneventhandler(name, new LineAndColumn(this.textLocation), value);
  }

  onopentag(name, attribs) {
    if (this.isJavaScriptElement(name, attribs)) {
      if (attribs.src) {
        this._cbs.onloadscript(attribs.src);
      }
      else {
        this.isInlineScript = true;
      }

      this.ontext('');
    }
    else if (this.isFrameElement(name, attribs))
      this._cbs.onloadframe(attribs.src);
  }

  onopentagname(name) {
    this.flushText();
  }

  oncomment(contents) {
    this.flushText();
  }

  ontext(c) {
    if (!this.textBuffer)
      this.textLocation.copy(this.location);
    this.textBuffer += c;
  }

  onclosetag(name) {
    let contents = this.flushText();
    if (this.isInlineScript) {
      if (contents.startsWith("<!--")) {
        this.textLocation.column += 3;
        contents = contents.substring(4, contents.length - 4);
      }

      this._cbs.oninlinescript(new LineAndColumn(this.textLocation), contents);
      this.isInlineScript = false;
    }
  }
};

module.exports = HTMLDriver;
