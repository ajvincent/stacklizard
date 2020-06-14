#!/usr/bin/env node
"use strict";
const StackLizard = {
  buildDriver(type, rootDir, options = {}) {
    const driverCtor = require("./drivers/" + type);
    return new driverCtor(rootDir, options);
  },

  getSerializer(type, startAsync, asyncRefs, driver, options) {
    const ctor = require("./serializers/" + type);
    return new ctor(startAsync, asyncRefs, driver, options);
  }
};

module.exports = StackLizard;

if (require.main === module) {
  (async function() {
    const command = require("./command-line");
    await command.execute();
  })();
}
