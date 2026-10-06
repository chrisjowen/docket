const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");
const { CLI_VERSION, NPX_DOCKET } = require("../scripts/cli.js");
const { runHook, sandbox, sleep, until } = require("./helpers.js");

const SCRIPT = "session-start.js";

const sandboxes = [];
afterEach(() => {
  for (const box of sandboxes.splice(0)) fs.rmSync(box.dir, { recursive: true, force: true });
});

function setup() {
  const box = sandbox();
  sandboxes.push(box);
  return box;
}

const input = (box) => ({ session_id: "s", cwd: box.repo, hook_event_name: "SessionStart", source: "startup" });

describe("session-start hook", () => {
  it("injects docket context", () => {
    const box = setup();
    const result = runHook(SCRIPT, input(box), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(output.hookSpecificOutput.additionalContext, /docket search/);
  });

  it("stays silent outside a docket repository", () => {
    const box = setup();
    const result = runHook(SCRIPT, input(box), box.env({ CLAUDE_PROJECT_DIR: box.dir }));

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("starts the sync in the background, so a slow sync never delays the session", async () => {
    const box = setup();
    box.installDocket();

    // The sync takes 5 s; the hook must be long gone by then.
    const result = runHook(SCRIPT, input(box), box.env({ CLAUDE_PROJECT_DIR: box.repo, FAKE_SLEEP_MS: "5000" }));

    assert.equal(result.status, 0);
    assert.ok(result.elapsedMs < 5000, `hook took ${result.elapsedMs} ms`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /docket/);
    const [call] = await until(() => {
      const calls = box.readCalls();
      return calls.length > 0 && calls;
    }, "docket sync to start");
    assert.equal(call.name, "docket");
    assert.deepEqual(call.argv, ["sync"]);
    assert.equal(call.cwd, box.repo);
  });

  it("does not start a second sync while one is still running", async () => {
    const box = setup();
    box.installDocket();
    const env = box.env({ CLAUDE_PROJECT_DIR: box.repo, FAKE_SLEEP_MS: "5000" });

    runHook(SCRIPT, input(box), env);
    await until(() => box.readCalls().length > 0, "the first sync to start");
    runHook(SCRIPT, { ...input(box), source: "compact" }, env);
    await sleep(500);

    assert.equal(box.readCalls().length, 1);
  });

  it("syncs through the pinned release on npx when the CLI is not installed", async () => {
    const box = setup();
    const result = runHook(SCRIPT, input(box), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    assert.equal(result.status, 0);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.ok(context.includes(`${NPX_DOCKET} search <query>`), context);
    const [call] = await until(() => {
      const calls = box.readCalls();
      return calls.length > 0 && calls;
    }, "npx to start");
    assert.equal(call.name, "npx");
    assert.deepEqual(call.argv, ["-y", `@chrisjowen/docket@${CLI_VERSION}`, "sync"]);
  });

  it("syncs with a docket installed on the path", async () => {
    const box = setup();
    const global = box.installGlobalDocket();
    const env = box.env({ CLAUDE_PROJECT_DIR: box.repo });
    env.PATH = `${global}${path.delimiter}${env.PATH}`;

    runHook(SCRIPT, input(box), env);

    const [call] = await until(() => {
      const calls = box.readCalls();
      return calls.length > 0 && calls;
    }, "docket sync to start");
    assert.equal(call.name, "docket");
    assert.deepEqual(call.argv, ["sync"]);
  });
});
