const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");
const { NPX_DOCKET, PLUGIN_BIN } = require("../scripts/cli.js");
const { checkoutKey } = require("../scripts/common.js");
const { runHook, sandbox, sleep, transcriptLines, until } = require("./helpers.js");

const SCRIPT = "review.js";
const SESSION = "session-1";

const sandboxes = [];
afterEach(() => {
  for (const box of sandboxes.splice(0)) fs.rmSync(box.dir, { recursive: true, force: true });
});

function setup() {
  const box = sandbox();
  sandboxes.push(box);
  const transcript = path.join(box.dir, `${SESSION}.jsonl`);
  const input = (extra = {}) => ({
    session_id: SESSION,
    transcript_path: transcript,
    cwd: box.repo,
    hook_event_name: "SessionEnd",
    reason: "prompt_input_exit",
    ...extra,
  });
  return { box, transcript, input };
}

/** Waits for the detached review to finish: its claude call, then its lock released. */
async function reviewed(box, calls = 1) {
  await until(() => box.readCalls().filter((c) => c.name === "claude").length >= calls, "claude to be called");
  await until(
    () => !fs.readdirSync(box.reviewDir).some((name) => name.endsWith(".lock")),
    "the review lock to be released",
  );
  return box.readCalls().filter((c) => c.name === "claude");
}

const promptOf = (call) => call.argv[call.argv.indexOf("-p") + 1];
const flag = (call, name) => call.argv[call.argv.indexOf(name) + 1];

describe("review hook at session end", () => {
  it("returns at once and reviews the session in the background", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    // The review takes 4 s; the hook must be long gone by then.
    const result = runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo, FAKE_SLEEP_MS: "4000" }));
    assert.equal(result.status, 0);
    assert.ok(result.elapsedMs < 4000, `hook took ${result.elapsedMs} ms`);

    const [call] = await reviewed(box);
    assert.equal(call.cwd, box.repo);
    assert.equal(call.review, "1", "the review's own hooks must stay quiet");
    assert.deepEqual(box.reviewState(SESSION), { entries: 3 });
  });

  it("reviews the project, not the subdirectory the session cd'd into", async () => {
    const { box, transcript, input } = setup();
    const sub = path.join(box.repo, "packages", "api");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input({ cwd: sub }), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    assert.equal(call.cwd, box.repo);
  });

  it("reviews every line exactly once across reviews", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(50));
    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    const [first] = await reviewed(box);
    assert.match(promptOf(first), /Review only lines 1 to 50;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 50 });

    // The session is resumed, runs on, and ends again.
    fs.appendFileSync(transcript, transcriptLines(45, { from: 50 }));
    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    const [, second] = await reviewed(box, 2);
    assert.match(promptOf(second), /Review only lines 51 to 95;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 95 });
  });

  it("reviews a short session's tail rather than waiting for it to grow", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(1));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Review only lines 1 to 1;/);
  });

  it("starts no review when nothing the user said is unreviewed", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(5, { prompt: false }));

    const result = runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    assert.equal(result.status, 0);
    await sleep(500);
    assert.deepEqual(box.readCalls(), []);
  });

  it("does nothing without a docket, or inside a review", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input({ cwd: box.dir }), box.env({ CLAUDE_PROJECT_DIR: box.dir }));
    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo, DOCKET_REVIEW: "1" }));
    await sleep(500);
    assert.deepEqual(box.readCalls(), []);
  });

  it("runs a cheap model without persisting the review session", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    assert.equal(flag(call, "--model"), "haiku");
    assert.ok(call.argv.includes("--no-session-persistence"));
    assert.equal(flag(call, "--permission-mode"), "dontAsk");
  });

  it("takes the model from DOCKET_REVIEW_MODEL", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo, DOCKET_REVIEW_MODEL: "opus" }));

    const [call] = await reviewed(box);
    assert.equal(flag(call, "--model"), "opus");
  });

  it("lets the reviewer run docket without any install", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    const allowed = call.argv.slice(call.argv.indexOf("--allowedTools") + 1);
    assert.ok(allowed.includes("Bash(docket *)"));
    assert.ok(allowed.includes(`Bash(${NPX_DOCKET} *)`));
    assert.match(promptOf(call), new RegExp(`as \`${NPX_DOCKET}\` if \`docket\` is not found`));
    // The plugin's own `docket` comes first; it finds the CLI or falls back to npx.
    assert.equal(call.path.split(path.delimiter)[0], PLUGIN_BIN);
  });

  it("has the reviewer record evidence, stamped with this session and date", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    const prompt = promptOf(call);
    assert.match(prompt, /Record evidence for every resource and every link/);
    assert.match(prompt, new RegExp(`session: ${SESSION}`));
    assert.match(prompt, /observedAt: \d{4}-\d{2}-\d{2}/);
    assert.match(prompt, /Never write a\s+confidence/);
    assert.match(prompt, /append an\s+evidence entry/);
    assert.match(prompt, /Record each place once per session/);
    assert.match(prompt, /files it read, the commands it ran/);
    const allowed = call.argv.slice(call.argv.indexOf("--allowedTools") + 1);
    assert.ok(allowed.includes("Bash(git rev-parse *)"));
    assert.ok(allowed.includes("Bash(git remote get-url *)"));
  });

  it("tells the reviewer never to capture secrets", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Never capture credentials, secrets, tokens, private keys or passwords/);
  });

  it("leaves the lines unreviewed when claude fails", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo, FAKE_EXIT: "1" }));
    await reviewed(box);
    assert.equal(box.reviewState(SESSION), null);

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    const [, retry] = await reviewed(box, 2);
    assert.match(promptOf(retry), /Review only lines 1 to 3;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 3 });
  });

  it("waits for a review already running in the repository instead of skipping", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));
    // Another session's review holds the lock: this test process stands in for it.
    fs.mkdirSync(box.reviewDir, { recursive: true });
    const lockFile = path.join(box.reviewDir, `${checkoutKey(box.repo)}.lock`);
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    await sleep(500);
    assert.deepEqual(box.readCalls(), [], "must not start while the lock is held");

    fs.unlinkSync(lockFile);
    await reviewed(box);
    assert.deepEqual(box.reviewState(SESSION), { entries: 3 });
  });

  it("reviews only what a review that finished while it waited left unreviewed", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(95));
    fs.mkdirSync(box.reviewDir, { recursive: true });
    const lockFile = path.join(box.reviewDir, `${checkoutKey(box.repo)}.lock`);
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    await sleep(500);
    // The earlier review of this session, holding the lock, reviewed lines 1-50.
    fs.writeFileSync(path.join(box.reviewDir, `${SESSION}.json`), JSON.stringify({ entries: 50 }));
    fs.unlinkSync(lockFile);

    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Review only lines 51 to 95;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 95 });
  });

  it("clears a lock left by a review that died", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));
    fs.mkdirSync(box.reviewDir, { recursive: true });
    const lockFile = path.join(box.reviewDir, `${checkoutKey(box.repo)}.lock`);
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 2 ** 22 + 12345 }));

    runHook(SCRIPT, input(), box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    await reviewed(box);
    assert.deepEqual(box.reviewState(SESSION), { entries: 3 });
  });
});

describe("review hook during the session", () => {
  const stop = (input) => input({ hook_event_name: "Stop", reason: undefined, stop_hook_active: false });

  it("reviews after a turn once enough of the session is unreviewed", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(199));
    runHook(SCRIPT, stop(input), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    await sleep(500);
    assert.deepEqual(box.readCalls(), [], "199 lines is not enough");

    fs.appendFileSync(transcript, transcriptLines(1, { from: 199, prompt: false }));
    const result = runHook(SCRIPT, stop(input), box.env({ CLAUDE_PROJECT_DIR: box.repo, FAKE_SLEEP_MS: "2000" }));
    assert.equal(result.status, 0);
    assert.ok(result.elapsedMs < 2000, `hook took ${result.elapsedMs} ms`);
    assert.equal(result.stdout, "", "a Stop hook that prints nothing never blocks the turn");

    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Review only lines 1 to 200;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 200 });
  });

  it("counts only unreviewed lines toward the next review", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(250));
    fs.mkdirSync(box.reviewDir, { recursive: true });
    fs.writeFileSync(path.join(box.reviewDir, `${SESSION}.json`), JSON.stringify({ entries: 100 }));

    runHook(SCRIPT, stop(input), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    await sleep(500);
    assert.deepEqual(box.readCalls(), []);

    fs.appendFileSync(transcript, transcriptLines(50, { from: 250 }));
    runHook(SCRIPT, stop(input), box.env({ CLAUDE_PROJECT_DIR: box.repo }));
    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Review only lines 101 to 300;/);
  });

  it("does not queue a second review of a session while one is pending", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(5));
    const env = box.env({ CLAUDE_PROJECT_DIR: box.repo, DOCKET_REVIEW_STOP_LINES: "5", FAKE_SLEEP_MS: "1500" });

    runHook(SCRIPT, stop(input), env);
    await until(() => box.readCalls().length > 0, "the first review to start");
    fs.appendFileSync(transcript, transcriptLines(5, { from: 5 }));
    runHook(SCRIPT, stop(input), env);
    runHook(SCRIPT, input({ hook_event_name: "PreCompact", trigger: "auto" }), env);
    await reviewed(box);
    await sleep(500);
    assert.equal(box.readCalls().length, 1);
    assert.deepEqual(box.reviewState(SESSION), { entries: 5 });

    // Once it is done, the next turn picks up what it did not cover.
    runHook(SCRIPT, stop(input), env);
    const [, next] = await reviewed(box, 2);
    assert.match(promptOf(next), /Review only lines 6 to 10;/);
  });

  it("still reviews the tail at session end while a review is pending", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(5));
    const env = box.env({ CLAUDE_PROJECT_DIR: box.repo, DOCKET_REVIEW_STOP_LINES: "5", FAKE_SLEEP_MS: "1000" });

    runHook(SCRIPT, stop(input), env);
    await until(() => box.readCalls().length > 0, "the first review to start");
    fs.appendFileSync(transcript, transcriptLines(2, { from: 5 }));
    runHook(SCRIPT, input(), env);

    const [, tail] = await reviewed(box, 2);
    assert.match(promptOf(tail), /Review only lines 6 to 7;/);
    assert.deepEqual(box.reviewState(SESSION), { entries: 7 });
  });

  it("reviews whatever is unreviewed before the conversation is compacted", async () => {
    const { box, transcript, input } = setup();
    fs.writeFileSync(transcript, transcriptLines(3));

    const precompact = input({ hook_event_name: "PreCompact", trigger: "auto" });
    runHook(SCRIPT, precompact, box.env({ CLAUDE_PROJECT_DIR: box.repo }));

    const [call] = await reviewed(box);
    assert.match(promptOf(call), /Review only lines 1 to 3;/);
  });
});
