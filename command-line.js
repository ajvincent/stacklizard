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

  standalone.addArgument(
    "--save-config",
    {
      action: "store",
      help: "A file to save the configuration of this job to."
    }
  );

  standalone.addArgument(
    "--save-output",
    {
      action: "store",
      help: "A file to save the output of this job to."
    }
  );

  subcommandMap.set("standalone", async (args) => {
    const dir = path.dirname(args.path), leaf = path.basename(args.path);
    const parseDriver = StackLizard.buildDriver("javascript", dir);
    await parseDriver.appendJSFile(leaf);
    parseDriver.parseSources();

    const startAsync = parseDriver.functionNodeFromLine(
      leaf, args.line, args.fnIndex
    );
    const asyncRefs = parseDriver.getAsyncStacks(startAsync);

    const serializer = StackLizard.getSerializer(
      "markdown", startAsync, asyncRefs, parseDriver, {nested: true}
    );

    await maybeSaveOutput(args, serializer);
    await maybeSaveConfig(args, parseDriver, serializer, startAsync);
  });
}

{
  const htmlDriver = subparsers.addParser(
    "html",
    {
      title: "Script analysis starting in a directory with a HTML file",
      help:  "Script analysis starting in a directory with a HTML file",
      addHelp: true,
    }
  );

  htmlDriver.addArgument(
    "rootDirectory",
    {
      action: "store",
      help: "The path to the project's root directory."
    }
  );

  htmlDriver.addArgument(
    "pathToHTML",
    {
      action: "store",
      help: "The location of the HTML file relative to the project's root directory."
    },
  );

  htmlDriver.addArgument(
    "pathToJS",
    {
      action: "store",
      help: "The location of the file containing the async function, relative to the project's root directory."
    }
  )

  htmlDriver.addArgument(
    "line",
    {
      action: "store",
      type: (x) => parseInt(x, 10),
      help: "The line number of the function.",
    }
  );

  htmlDriver.addArgument(
    "--fnIndex",
    {
      action: "store",
      defaultValue: 0,
      type: (x) => parseInt(x, 10),
      help: "If there is more than one function on the line, the index of the function.",
    }
  );

  htmlDriver.addArgument(
    "--save-config",
    {
      action: "store",
      help: "A file to save the configuration of this job to."
    }
  );

  htmlDriver.addArgument(
    "--save-output",
    {
      action: "store",
      help: "A file to save the output of this job to."
    }
  );

  subcommandMap.set("html", async (args) => {
    const parseDriver = StackLizard.buildDriver("html", args.rootDirectory);
    await parseDriver.appendSourcesViaHTML(args.pathToHTML);

    parseDriver.parseSources();

    const startAsync = parseDriver.functionNodeFromLine(
      args.pathToJS, args.line, args.fnIndex
    );
    const asyncRefs = parseDriver.getAsyncStacks(startAsync);

    const serializer = StackLizard.getSerializer(
      "markdown", startAsync, asyncRefs, parseDriver, {nested: true}
    );

    await maybeSaveOutput(args, serializer);
    await maybeSaveConfig(args, parseDriver, serializer, startAsync);
  });
}

// mozilla
{
  const mozilla = subparsers.addParser(
    "mozilla",
    {
      title: "Script analysis starting in a mozilla source directory",
      help:  "Script analysis starting in a mozilla source directory",
      addHelp: true,
    }
  );

  mozilla.addArgument(
    "json",
    {
      action: "store",
      help: "The location of the configuration file."
    }
  );

  mozilla.addArgument(
    "--save-config",
    {
      action: "store",
      help: "A file to save the configuration of this job to."
    }
  );

  mozilla.addArgument(
    "--save-output",
    {
      action: "store",
      help: "A file to save the output of this job to."
    }
  );

  subcommandMap.set("mozilla", async (args) => {
    const pathToConfig = path.resolve(process.cwd(), args.json);
    const config = JSON.parse(await fs.readFile(pathToConfig, { encoding: "utf-8"}));

    const rootDir = path.resolve(process.cwd(), config.driver.root);
    const parseDriver = StackLizard.buildDriver(
      "mozilla",
      rootDir,
      config.driver.options || {}
    );

    console.time("mozilla");
    await parseDriver.buildChromeRegistry();
    console.timeLog("mozilla", "buildChromeRegistry");
    await parseDriver.gatherXPCOMClassData();
    console.timeLog("mozilla", "gatherXPCOMClassData");

    const {startAsync, asyncRefs} = await parseDriver.analyzeByConfiguration(config.driver, {
      newIgnore: args.ignore
    });
    console.timeLog("mozilla", "analyzeByConfiguration");

    const serializer = StackLizard.getSerializer(
      config.serializer.type,
      startAsync,
      asyncRefs,
      parseDriver,
      config.serializer.options || {}
    );
    await maybeSaveOutput(args, serializer);
    console.timeEnd("mozilla");

    await maybeSaveConfig(args, parseDriver, serializer, startAsync);

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

  configuration.addArgument(
    "--ignore",
    {
      action: "store",
      type: (data) => {
        const re = /^(.+):(\d+) (.+)\[(\d+)]/;
        const [path, lineStr, type, indexStr] = Array.from(re.exec(data)).slice(1);
        const line = parseInt(lineStr, 10);
        const index = parseInt(indexStr, 10);

        return {
          path,
          line,
          type,
          index
        };
      },
      help: "Add a node as formatted from a previous serialization to the ignore list"
    }
  );

  configuration.addArgument(
    "--save-config",
    {
      action: "store",
      help: "A file to save the configuration of this job to."
    }
  );

  configuration.addArgument(
    "--save-output",
    {
      action: "store",
      help: "A file to save the output of this job to."
    }
  );

  subcommandMap.set("configuration", async (args) => {
    const pathToConfig = path.resolve(process.cwd(), args.json);
    const config = JSON.parse(await fs.readFile(pathToConfig, { encoding: "utf-8"}));

    const rootDir = path.resolve(process.cwd(), config.driver.root);
    const parseDriver = StackLizard.buildDriver(
      config.driver.type,
      rootDir,
      config.driver.options || {}
    );

    const {startAsync, asyncRefs} = await parseDriver.analyzeByConfiguration(config.driver, {
      newIgnore: args.ignore
    });

    const serializer = StackLizard.getSerializer(
      config.serializer.type,
      startAsync,
      asyncRefs,
      parseDriver,
      config.serializer.options || {}
    );
    await maybeSaveOutput(args, serializer);

    await maybeSaveConfig(args, parseDriver, serializer, startAsync);
  });
}

async function maybeSaveOutput(args, serializer) {
  const output = serializer.serialize();
  if (!args.save_output) {
    console.log(output);
    return;
  }

  const pathToConfig = path.resolve(process.cwd(), args.save_output);
  await fs.writeFile(pathToConfig, output, { encoding: "utf-8" } );
}

async function maybeSaveConfig(args, parseDriver, serializer, startAsync) {
  if (!args.save_config)
    return;
  const output = JSON.stringify({
    driver: parseDriver.getConfiguration(startAsync),
    serializer: serializer.getConfiguration()
  }, null, 2) + "\n";

  const pathToConfig = path.resolve(process.cwd(), args.save_config);
  await fs.writeFile(pathToConfig, output, { encoding: "utf-8" } );
}

module.exports = {
  execute: async function() {
    const args = argparser.parseArgs();
    await subcommandMap.get(args.subcommand_name)(args);
  }
};
