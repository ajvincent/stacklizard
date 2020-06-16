# stacklizard
A static-analysis tool to simulate marking one JavaScript function async, and determining what functions and function calls must change.

## A simplified scenario
Suppose you have the following code:
```javascript
// Goal:  Determine where we have to make changes if A.prototype.e becomes asynchronous.

function A() {
  this.x = this.d();
}
A.prototype = {
  a: function() {
    console.log(this.b());
  },

  b: function() {
    void(this.c);
  },

  get c() {
    return this.d() + 1;
  },

  d: function() {
    // just a comment
    let f = this.f();
    let e = this.e(f);
    return e + 1;
  },

  e: function(y) {
    return y + this.g() + 1;
  },

  f: function() {
    return 0;
  },

  g: function() {
    return 1;
  }
};

const B = new A();

```
In this scenario, `B.d() === 3`.  Everything's fine.  But for some reason, you need to mark `A.prototype.e` asynchronous:
```javascript
  e: async function(y) {
    return y + this.g() + 1;
  },
```

Evaluating B.d() results in `B.d() = [object Promise]1`.  That's not desirable.  To fix this, we'd have to make the caller await the promise.
```javascript
  d: function() {
    // just a comment
    let f = this.f();
    let e = await this.e(f);
    return e + 1;
  },
```

Except _that_ causes **SyntaxError: await is only valid in async functions and async generators**.  So then we mark d as async:
```javascript
  d: async function() {
    // just a comment
    let f = this.f();
    let e = await this.e(f);
    return e + 1;
  },
```
`B.d() = [object Promise]`

This we can await no problem... except that the constructor `A()` references `this.d()`.  We broke that as well, so we try to fix it:
```javascript
function A() {
  this.x = await this.d();
}
```
**SyntaxError: await is only valid in async functions and async generators**

Okay, mark the constructor async:
```javascript
async function A() {
  this.x = await this.d();
}
// ...
const B = new A();
```
**TypeError: A is not a constructor**

At this point you might throw your hands up in frustration (and rightly so).  But if you have to make that original function `e()` async, it might be helpful to know all the places you need to make changes.  StackLizard is for this purpose.

```
./stacklizard.js standalone docs/use-case/a/a.js 26
- e(), async a.js:26 FunctionExpression[0]
  - d(), await a.js:22 CallExpression[0], async a.js:19 FunctionExpression[0]
    - c(), await a.js:16 CallExpression[0], async a.js:15 FunctionExpression[0], accessor
      - b(), await a.js:12 MemberExpression[0], async a.js:11 FunctionExpression[0]
        - a(), await a.js:8 CallExpression[1], async a.js:7 FunctionExpression[0]
    - A(), await a.js:4 Identifier[1], async a.js:3 FunctionDeclaration[0], constructor
      - A(), await a.js:39 NewExpression[0]
- **SyntaxError**: async a.js:15 FunctionExpression[0], accessor
- **SyntaxError**: async a.js:3 FunctionDeclaration[0], constructor

```

Notably, StackLizard doesn't fix these problems for you, but it does point them out.

## Installation

StackLizard should be treated as a NPM module, and installed as such:

```sh
npm install stacklizard
```
## Command-line Usage

From the command-line, you have several subcommands.  Generally speaking, I recommend the following:
1. Using standalone or html subcommands to generate an initial configuration file
1. Altering the configuration file as necessary
1. Using the configuration subcommand with the generated configuration file to create revised results.
1. Repeat as you desire.

### standalone

This reads a single JavaScript file, marks one function async as you requested (by line number and optionally a "function index", the index of the function among the list of functions on that line), then generates a stack trace.

Optional arguments:
- `--fnIndex=0` to specify the 0th function on the line to mark async
- `--save-config path/to/json ` where you can specify a location to write a JSON configuration file for reuse.

### configuration

This takes a configuration file you've generated via --save-config with some optional hand-editing, and re-runs the job based on that configuration.

Documentation for the configuration file format is at [sample-config.json.yaml](sample-config.json.yaml) in this repository.

Optional arguments:
- `--ignore "pathToFile:line type[index]"` to mark a node ignored.  Cut & paste the string from an earlier serialization.
- `--save-config path/to/json ` where you can specify a location to write a JSON configuration file for reuse.

### html

This takes a few arguments:
- A root directory for a HTML project
- A path to the HTML file where scripts run
- A path to the HTML or JavaScript file containing the function to mark async
- The line number of the function
- `--fnIndex=0` to specify the 0th function on the line to mark async
- `--save-config path/to/json ` where you can specify a location to write a JSON configuration file for reuse.

## Usage within Node

### Standalone mode
```javascript
const StackLizard = require("stacklizard");

(async function() {
  const parseDriver = StackLizard.buildDriver("javascript", rootDir, options = {});

  // option 1: load from the file system
  await parseDriver.appendJSFile("path/to/JSFile/from/rootDir"); // always a relative path

  // option 2: load from in-memory string, no file i/o
  parseDriver.appendSource(pathToFile, firstLineInFile, source); 

  // Generate the Abstract Syntax Tree via espree and gather information via estraverse.
  parseDriver.parseSources();

  // Get a function AST node.
  const startAsync = parseDriver.functionNodeFromLine(
    "path/to/JSFile/from/rootDir", lineNumber, functionIndex
  );
  
  // Mark nodes async and await as needed from the function AST node, marked async.  Returns a Map().
  const asyncRefs = parseDriver.getAsyncStacks(startAsync);

  // Build a serializer.
  const serializer = StackLizard.getSerializer(
    "markdown", startAsync, asyncRefs, parseDriver, {nested: true}
  );

  // Serialize the results in a human-readable form.
  console.log(serializer.serialize());
  
  // Get a configuration to save to a file.
  const configuration = {
    driver: parseDriver.getConfiguration(startAsync),
    serializer: serializer.getConfiguration()
  };
})();
```

### HTML mode
```javascript
(async function() {
  const parseDriver = StackLizard.buildDriver("html", rootDirectory, options = {});

  // load from the file system, and get all the JavaScript code inline and from external files
  await parseDriver.appendSourcesViaHTML(pathToHTML);

  // Generate the Abstract Syntax Tree via espree and gather information via estraverse.
  parseDriver.parseSources();

  // Get a function AST node.
  const startAsync = parseDriver.functionNodeFromLine(
    args.pathToJS, args.line, args.fnIndex
  );

  // Mark nodes async and await as needed from the function AST node, marked async.  Returns a Map().
  const asyncRefs = parseDriver.getAsyncStacks(startAsync);

  // Build a serializer.
  const serializer = StackLizard.getSerializer(
    "markdown", startAsync, asyncRefs, parseDriver, {nested: true}
  );

  // Serialize the results in a human-readable form.
  console.log(serializer.serialize());

  // Get a configuration to save to a file.
  const configuration = {
    driver: parseDriver.getConfiguration(startAsync),
    serializer: serializer.getConfiguration()
  };
})();
```

### Configuration mode
```javascript
// config is a JSON object, parsed from a configuration file saved in a previous session.
async function doTheAnalysis(config) {
  // Build the parse driver.
  const parseDriver = StackLizard.buildDriver(
    config.driver.type,
    path.resolve(process.cwd(), config.driver.root), // probably something like this
    config.driver.options || {}
  );

  // Analyze everything at once.
  const {startAsync, asyncRefs} = await parseDriver.analyzeByConfiguration(config.driver);

  // Build the serializer.
  const serializer = StackLizard.getSerializer(
    config.serializer.type,
    startAsync,
    asyncRefs,
    parseDriver,
    config.serializer.options || {}
  );

  // Serialize the results in a human-readable form.
  console.log(serializer.serialize());
}
```

## A few notes

* StackLizard picks up await nodes by their local name ("b", not "A.prototype.b"), and marks them most aggressively, sometimes too much so.  You can override this and tell StackLizard to ignore a node via the `ignore` parameter in a configuration file (recommended) or with code like this:
```javascript
  const ignorable = this.nodeByLineFilterIndex(
    ignore.path,
    ignore.line,
    ignore.index,
    n => n.type === ignore.type
  );
  this.markIgnored(ignorable);
```
