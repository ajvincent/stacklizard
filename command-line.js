"use strict";

/**
 * @fileoverview
 *
 * Implement a command-line handler for StackLizard.
 */
const ArgumentParser = require("argparse").ArgumentParser;
const fs = require("fs").promises;
const path = require("path");

const StackLizard = require("./stacklizard");

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

{
  const standalone = subparsers.addParser(
    "standalone",
    {
      title: "Stand-alone JS file analysis",
      help:  "Stand-alone JS file analysis",
      addHelp: true,
    }
  );

  standalone.addArgument(
    "path",
    {
      action: "store",
      help: "The location of the file to load."
    },
  );

  standalone.addArgument(
    "line",
    {
      action: "store",
      type: (x) => parseInt(x, 10),
      help: "The line number of the function.",
    }
  );

  standalone.addArgument(
    "--fnIndex",
    {
      action: "store",
      defaultValue: 0,
      type: (x) => parseInt(x, 10),
      help: "If there is more than one function on the line, the index of the function.",
    }
  );

  subcommandMap.set("standalone", async (args) => {
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
  });
}

{
  const configuration = subparsers.addParser(
    "configuration",
    {
      title: "Use a JSON file as the configuration for running this job.",
      help:  "Use a JSON file as the configuration for running this job.",
      addHelp: true,
    }
  );

  configuration.addArgument(
    "json",
    {
      action: "store",
      help: "The location of the configuration file."
    }
  );

  subcommandMap.set("configuration", async (args) => {
    const pathToConfig = path.resolve(process.cwd(), args.json);
    const config = JSON.parse(await fs.readFile(pathToConfig));

    const rootDir = path.resolve(path.dirname(pathToConfig), config.driver.root);
    const parseDriver = StackLizard.buildDriver(
      config.driver.type,
      rootDir,
      config.driver.options || {}
    );

    const {startAsync, asyncRefs} = await parseDriver.analyzeByConfiguration(config.driver);

    const serializer = StackLizard.getSerializer(config.serializer.type);

    console.log(serializer(
      startAsync, asyncRefs, parseDriver, config.serializer.options || {}
    ));
  });
}

module.exports = {
  execute: async function() {
    const args = argparser.parseArgs();
    await subcommandMap.get(args.subcommand_name)(args);
  }
};
