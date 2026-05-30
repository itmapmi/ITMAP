const { join } = require("path");

// Store Puppeteer's browser download inside the project tree so it ships with
// the deployment image (like node_modules). The default cache (~/.cache/
// puppeteer) is not reliably present/readable in the deployed environment,
// which caused Chromium "spawn EIO" failures in production.
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
