// Sandboxes for driving the hook scripts the way Claude Code does: JSON on
// stdin, a scratch HOME, and fake `claude`, `npx` and `docket` binaries on
// PATH that record how they were called instead of doing anything. PATH holds
// only the sandbox's own `bin/` and the system directories, so no real `npx`
// or installed `docket` is ever reached.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN = path.join(__dirname, "..");
const SCRIPTS = path.join(PLUGIN, "scripts");

// Records one JSON line per call, then sleeps and exits as told by the env.
const FAKE_BIN = `#!/usr/bin/env node
const fs = require("node:fs");
const name = require("node:path").basename(process.argv[1]);
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify({
  name,
  bin: process.argv[1],
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  path: process.env.PATH,
  review: process.env.DOCKET_REVIEW || null,
}) + "\\n");
const sleep = Number(process.env.FAKE_SLEEP_MS) || 0;
setTimeout(() => process.exit(Number(process.env.FAKE_EXIT) || 0), sleep);
`;

function sandbox() {
  // Real-pathed: macOS's tmpdir is a symlink, and the scripts canonicalize.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docket-plugin-")));
  const home = path.join(dir, "home");
  const repo = path.join(dir, "repo");
  const bin = path.join(dir, "bin");
  for (const d of [home, path.join(repo, ".docket"), bin]) fs.mkdirSync(d, { recursive: true });
  for (const name of ["claude", "npx"]) fs.writeFileSync(path.join(bin, name), FAKE_BIN, { mode: 0o755 });
  // The fakes' `#!/usr/bin/env node` finds this node, and nothing else beside it.
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const calls = path.join(dir, "calls.jsonl");

  return {
    dir,
    home,
    repo,
    calls,
    env(extra = {}) {
      const env = {
        PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        HOME: home,
        FAKE_CALLS: calls,
        DOCKET_REVIEW_LOCK_POLL_MS: "50",
        ...extra,
      };
      for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
      return env;
    },
    /** Installs a fake `docket` CLI in a directory of its own, as `npm i -g` would. */
    installGlobalDocket() {
      const global = path.join(dir, "global");
      fs.mkdirSync(global, { recursive: true });
      fs.writeFileSync(path.join(global, "docket"), FAKE_BIN, { mode: 0o755 });
      return global;
    },
    /** Installs a fake `docket` CLI in the repo, as `pnpm add -D` would. */
    installDocket() {
      const local = path.join(repo, "node_modules", ".bin");
      fs.mkdirSync(local, { recursive: true });
      fs.writeFileSync(path.join(local, "docket"), FAKE_BIN, { mode: 0o755 });
      return local;
    },
    readCalls() {
      try {
        return fs
          .readFileSync(calls, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
    reviewState(session) {
      try {
        return JSON.parse(fs.readFileSync(path.join(home, ".cache", "docket", "reviews", `${session}.json`), "utf8"));
      } catch {
        return null;
      }
    },
    reviewDir: path.join(home, ".cache", "docket", "reviews"),
  };
}

/** Runs a hook script with `input` on stdin, as Claude Code does. */
function runHook(script, input, env) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script)], {
    input: JSON.stringify(input),
    env,
    cwd: input.cwd || os.tmpdir(),
    encoding: "utf8",
    timeout: 10_000,
  });
  return { ...result, elapsedMs: Date.now() - started };
}

/** A transcript of `count` lines, the first a user prompt unless told otherwise. */
function transcriptLines(count, { prompt = true, from = 0 } = {}) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(
      prompt && i === 0
        ? JSON.stringify({ type: "user", message: { role: "user", content: `prompt ${from + i}` } })
        : JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `line ${from + i}` }] } }),
    );
  }
  return lines.map((line) => `${line}\n`).join("");
}

/** Polls until `check` returns something truthy. */
async function until(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

module.exports = { PLUGIN, runHook, sandbox, sleep, transcriptLines, until };
