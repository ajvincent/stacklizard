#!/usr/bin/env node
"use strict";
const StackLizard = {
  buildDriver(type, rootDir, options = {}) {
    const driverCtor = require("./drivers/" + type);
    return new driverCtor(rootDir, options);
  },

  getSerializer(type) {
    return require("./serializers/" + type);
  }
};

module.exports = StackLizard;

if (require.main === module) {
  (async function() {
    const command = require("./command-line");
    await command.execute();
  })();
}
