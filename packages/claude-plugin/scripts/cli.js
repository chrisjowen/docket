// Finds the `docket` CLI for the hooks and for the plugin's own `bin/docket`,
// so the plugin works without a separate CLI install.
//
// The release pinned here is the one place the plugin names a CLI version. It
// must match packages/docket/package.json; the plugin tests fail if they drift.

const fs = require("node:fs");
const path = require("node:path");
const { canonicalPath } = require("./common.js");

const CLI_PACKAGE = "@chrisjowen/docket";
const CLI_VERSION = "0.2.0";

/** What runs the pinned release when no `docket` is installed. */
const NPX_COMMAND = ["npx", ["-y", `${CLI_PACKAGE}@${CLI_VERSION}`]];

/** The same, as one would type it. */
const NPX_DOCKET = `npx -y ${CLI_PACKAGE}@${CLI_VERSION}`;

/** The plugin's own `bin/`, which Claude Code puts on the Bash tool's path. */
const PLUGIN_BIN = path.join(__dirname, "..", "bin");

const EXE = process.platform === "win32" ? ["docket.cmd", "docket.exe", "docket"] : ["docket"];

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The first `docket` on `PATH` that is not this plugin's own wrapper. */
function docketOnPath(envPath = process.env.PATH || "") {
  const own = canonicalPath(PLUGIN_BIN);
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || canonicalPath(dir) === own) continue;
    for (const name of EXE) {
      const file = path.join(dir, name);
      if (isExecutable(file)) return file;
    }
  }
  return null;
}

/** The project's own `docket` binary, when the CLI is installed in it. */
function localDocketBin(root) {
  const bin = path.join(root, "node_modules", ".bin", EXE[0]);
  return fs.existsSync(bin) ? bin : null;
}

/**
 * How to run `docket` in `root`, as `[command, args]`: the project's own CLI,
 * else one on the path, else the pinned release through npx.
 */
function resolveDocket(root, envPath) {
  const bin = localDocketBin(root) || docketOnPath(envPath);
  return bin ? [bin, []] : NPX_COMMAND;
}

module.exports = {
  CLI_PACKAGE,
  CLI_VERSION,
  NPX_COMMAND,
  NPX_DOCKET,
  PLUGIN_BIN,
  docketOnPath,
  resolveDocket,
};
