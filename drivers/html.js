"use strict";

const fs = require("fs").promises;
const path = require("path");

const JSDriver = require("./javascript");
const ScriptExtractor = require("./html-utilities/scriptExtractor");

class HTMLParseDriver extends JSDriver {
  constructor(rootDir, options = {}) {
    super(rootDir, options);
    this.cwd = process.cwd();
    this.fullRoot = path.resolve(this.cwd, this.rootDir);
    this.pathToHTML = "";
  }

  async analyzeByConfiguration(config) {
    let ignoreFilters = [];
    if (Array.isArray(config.ignore)) {
      ignoreFilters = config.ignore.map(ignoreData =>
        n => n.type === ignoreData.type
      );
    }

    await this.appendSourcesViaHTML(config.pathToHTML);

    this.parseSources();

    if (Array.isArray(config.ignore)) {
      config.ignore.map((ignore, filterIndex) => {
        const ignorable = this.nodeByLineFilterIndex(
          ignore.path,
          ignore.line,
          ignore.index,
          ignoreFilters[filterIndex]
        );
        this.markIgnored(ignorable);
      });
    }

    const startAsync = this.functionNodeFromLine(
      config.markAsync.path,
      config.markAsync.line,
      config.markAsync.functionIndex || 0
    );

    const asyncRefs = this.getAsyncStacks(startAsync);

    this.cachedConfiguration = config;

    return { startAsync, asyncRefs };
  }

  /**
   * Get a JSON-serializable configuration object.
   *
   * @param {Node} startAsync The starting async node.
   *
   * @public
   * @returns {Object}
   */
  getConfiguration(startAsync) {
    if (this.cachedConfiguration)
      return this.cachedConfiguration;

    let rv = JSDriver.prototype.getConfiguration.apply(this, [startAsync]);
    delete rv.scripts;

    rv.type = "html";
    rv.pathToHTML = this.pathToHTML;

    return rv;
  }

  async appendSourcesViaHTML(pathToHTML) {
    if (this.pathToHTML)
      throw new Error("HTML file already parsed");

    const fullPath = path.resolve(this.fullRoot, pathToHTML);
    if (!fullPath.startsWith(this.fullRoot))
      throw new Error("HTML file lives outside project root directory: " + pathToHTML);

    this.pathToHTML = pathToHTML;
    this.fullPathToHTML = fullPath;

    const scriptExtractor = new ScriptExtractor();
    let scriptCallbacks = this.getScriptCallbacks(scriptExtractor);

    const source = await fs.readFile(fullPath, { encoding: "UTF-8" } );
    scriptExtractor.parseHTML(source);

    scriptCallbacks = scriptCallbacks.flat();
    for (let i = 0; i < scriptCallbacks.length; i++) {
      await scriptCallbacks[i]();
    }
  }

  getScriptCallbacks(scriptExtractor) {
    // Order of processing:  baseHref, loadscript + inlinescript, eventhandler
    const baseHrefHandling = [];
    const loadScriptCallbacks = [];
    const eventHandlerCallbacks = [];

    let baseHref = this.pathToHTML.replace(/\/[^/]*$/, "/"), baseUpdated = false;

    scriptExtractor.events.on("baseHref", (href) => {
      if (baseUpdated)
        throw new Error("Why set base href twice?");
      baseUpdated = true;
      baseHrefHandling.unshift(() => {
        baseHref = this.resolveURI(baseHref, href);
        if (baseHref === "")
          throw new Error("baseHref lives outside project root directory: " + href);
      });
    });

    scriptExtractor.events.on("inlinescript", (location, contents) => {
      loadScriptCallbacks.push(() => {
        this.appendSource(this.pathToHTML, location.line, contents)
      });
    });

    scriptExtractor.events.on("loadscript", async (src) => {
      loadScriptCallbacks.push(async () => {
        const uri = this.resolveURI(baseHref, src);
        if (uri === "")
          throw new Error("src lives outside project root directory: " + src);
        await this.appendJSFile(uri);
      });
    });

    scriptExtractor.events.on("eventhandler", (name, location, attrValue) => {
      eventHandlerCallbacks.push(() => {
        this.appendSource(
          "(event handler)",
          0,
          "void(function(event) {"
        );
        this.appendSource(
          `${this.pathToHTML}:${name}`,
          location.line,
          attrValue
        );
        this.appendSource(
          "(event handler)",
          0,
          "});"
        );
      });
    });

    // We're not going to handle frames.  That's a different scope, and gets ugly.

    return [
      baseHrefHandling,
      loadScriptCallbacks,
      eventHandlerCallbacks
    ];
  }

  resolveURI(baseHref, relativePath) {
    let fullAbsolutePath = path.join(this.fullRoot, baseHref, relativePath);
    if (fullAbsolutePath.startsWith(this.fullRoot))
      return fullAbsolutePath.substr(this.fullRoot.length + 1);
    return "";
  }
}

module.exports = HTMLParseDriver;
