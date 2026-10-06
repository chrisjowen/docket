const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");
const { CLI_PACKAGE, CLI_VERSION, PLUGIN_BIN } = require("../scripts/cli.js");
const { PLUGIN, sandbox } = require("./helpers.js");

const CLI_MANIFEST = path.join(PLUGIN, "..", "docket", "package.json");

const sandboxes = [];
afterEach(() => {
  for (const box of sandboxes.splice(0)) fs.rmSync(box.dir, { recursive: true, force: true });
});

function setup() {
  const box = sandbox();
  sandboxes.push(box);
  return box;
}

/** Runs the plugin's `bin/docket` from the repo, with that `bin/` on PATH as Claude Code puts it. */
function runDocket(box, args, { prefix = [] } = {}) {
  const env = box.env();
  env.PATH = [...prefix, PLUGIN_BIN, env.PATH].join(path.delimiter);
  return spawnSync(path.join(PLUGIN_BIN, "docket"), args, { cwd: box.repo, env, encoding: "utf8", timeout: 10_000 });
}

describe("docket CLI resolution", () => {
  it("pins the CLI release this repository builds", () => {
    const manifest = JSON.parse(fs.readFileSync(CLI_MANIFEST, "utf8"));
    assert.equal(CLI_PACKAGE, manifest.name);
    assert.equal(CLI_VERSION, manifest.version, "bump CLI_VERSION in scripts/cli.js with the CLI's version");
  });

  it("runs the project's own CLI first, passing every argument through", () => {
    const box = setup();
    const local = box.installDocket();
    const global = box.installGlobalDocket();

    const result = runDocket(box, ["search", "orders db"], { prefix: [global] });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      box.readCalls().map((call) => [call.bin, call.argv]),
      [[path.join(local, "docket"), ["search", "orders db"]]],
    );
  });

  it("runs a docket on the path, skipping its own wrapper", () => {
    const box = setup();
    const global = box.installGlobalDocket();

    // Claude Code may put the plugin's bin/ ahead of the real CLI.
    const env = box.env();
    env.PATH = [PLUGIN_BIN, global, env.PATH].join(path.delimiter);
    const result = spawnSync(path.join(PLUGIN_BIN, "docket"), ["validate"], { cwd: box.repo, env, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      box.readCalls().map((call) => [call.bin, call.argv]),
      [[path.join(global, "docket"), ["validate"]]],
    );
  });

  it("falls back to the pinned release through npx", () => {
    const box = setup();

    const result = runDocket(box, ["ontology", "list"]);

    assert.equal(result.status, 0, result.stderr);
    const [call] = box.readCalls();
    assert.equal(call.name, "npx");
    assert.deepEqual(call.argv, ["-y", `${CLI_PACKAGE}@${CLI_VERSION}`, "ontology", "list"]);
  });

  it("reaches npx when another copy of the plugin is on the path", () => {
    const box = setup();
    const copies = ["old", "new"].map((name) => {
      const copy = path.join(box.dir, "plugins", name);
      for (const dir of ["bin", "scripts"]) fs.cpSync(path.join(PLUGIN, dir), path.join(copy, dir), { recursive: true });
      return path.join(copy, "bin");
    });
    const env = box.env();
    env.PATH = [...copies, env.PATH].join(path.delimiter);

    const result = spawnSync(path.join(copies[0], "docket"), ["validate"], {
      cwd: box.repo,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      box.readCalls().map((call) => [call.name, call.argv]),
      [["npx", ["-y", `${CLI_PACKAGE}@${CLI_VERSION}`, "validate"]]],
    );
  });

  it("exits with the CLI's exit code", () => {
    const box = setup();
    box.installDocket();
    const env = box.env({ FAKE_EXIT: "3" });
    env.PATH = [PLUGIN_BIN, env.PATH].join(path.delimiter);

    const result = spawnSync(path.join(PLUGIN_BIN, "docket"), ["validate"], { cwd: box.repo, env });

    assert.equal(result.status, 3);
  });
});
