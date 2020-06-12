"use strict";

/**
 * @fileoverview
 *
 * Implement a command-line handler for StackLizard.
 */
const StackLizard = require("./stacklizard");
const path = require("path");
const ArgumentParser = require("argparse").ArgumentParser;

const argparser = new ArgumentParser({
  version: "0.2.0",
  addHelp: true,
  description: "Search a JavaScript abstract syntax tree for functions to mark async and await, assuming one function marked async.",
});

const subparsers = argparser.addSubparsers({
  title: "Command",
  dest: "subcommand_name",
  required: true,
});

const subcommandMap = new Map(/* subcommand: execute */);

function buildSubparser(subcommand, options, setup, execute) {
  const subparser = subparsers.addParser(subcommand, options);
  setup(subparser);
  subparser.addArgument(
    "line",
    {
      action: "store",
      type: (x) => parseInt(x, 10),
      help: "The line number of the function.",
    }
  );
  
  subparser.addArgument(
    "fnIndex",
    {
      action: "store",
      type: (x) => parseInt(x, 10),
      help: "If there is more than one function on the line, the index of the function.",
    }
  );
  subcommandMap.set(subcommand, execute);
}

buildSubparser(
  'standalone',
  {
    title: "Stand-alone JS file analysis",
    help: "Stand-alone JS file analysis",
    addHelp: true,
  },
  (standalone) => {
    standalone.addArgument(
      "path",
      {
        action: "store",
        help: "The location of the file to load."
      },
    );
  },
  async (args) => {
    const dir = path.dirname(args.path), leaf = path.basename(args.path);
    const driver = StackLizard.buildDriver("javascript", dir);
    await driver.appendJSFile(leaf);
    driver.parseSources();

    const startAsync = driver.functionNodeFromLine(
      leaf, args.line, args.fnIndex
    );
    const asyncRefs = driver.getAsyncStacks(startAsync);

    const serializer = StackLizard.getSerializer("markdown");
    const analysis = serializer(startAsync, asyncRefs, driver, {nested: true});

    console.log(analysis);
  }
);

module.exports = {
  execute: async function() {
    const args = argparser.parseArgs();
    await subcommandMap.get(args.subcommand_name)(args);
  }
};
