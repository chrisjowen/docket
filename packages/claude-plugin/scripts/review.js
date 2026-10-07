#!/usr/bin/env node
// Stop, PreCompact and SessionEnd hook (SPEC §55).
// Collects evidence from the part of the session no review has seen yet, as
// the session goes rather than only once it is over:
//
// - Stop, after a turn, once that part has grown by 200 transcript lines
// - PreCompact, before the conversation is summarised
// - SessionEnd, for the tail
//
// Mid-session reviews skip while a review of the same session is still queued
// or running; the session-end review always runs. The review runs in the
// background: this starts a detached runner (`review-runner.js`) that drives a
// headless `claude -p` over the transcript, following the `remember` skill, and
// returns at once so no turn and no session end is ever delayed. It does not
// create files itself; the review agent exercises judgement.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { PLUGIN_BIN } = require("./cli.js");
const {
  CACHE_DIR,
  DEFAULT_REVIEW_MODEL,
  checkoutKey,
  isRunning,
  projectRoot,
  readJson,
  readStdin,
} = require("./common.js");

const STATE_DIR = path.join(CACHE_DIR, "reviews");

// Set in the review agent's environment so its own hooks stay quiet.
const REVIEW_ENV = "DOCKET_REVIEW";

/** Unreviewed transcript lines that make a Stop worth a review. */
const REVIEW_EVERY = Number(process.env.DOCKET_REVIEW_STOP_LINES) || 200;

/** How many unreviewed lines this event needs before it starts a review. Only Stop waits for the session to grow. */
function threshold(event) {
  return event === "Stop" ? REVIEW_EVERY : 1;
}

/** Lines in a JSONL file. Each entry ends with a newline, so count those. */
function countLines(text) {
  let lines = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines += 1;
  return lines;
}

/**
 * Whether the user said anything in these entries. A stretch with no prompt -
 * a session opened and closed, or only bookkeeping since the last review - has
 * nothing to review, so no model is started for it.
 */
function hasUserPrompt(entries) {
  return entries.some((line) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    if (entry.type !== "user" || entry.isMeta) return false;
    const content = entry.message && entry.message.content;
    if (typeof content === "string") return content.trim() !== "";
    return Array.isArray(content) && content.some((block) => block && block.type === "text");
  });
}

const input = readStdin();

if (process.env[REVIEW_ENV]) process.exit(0);
if (!input.transcript_path) process.exit(0);

const event = input.hook_event_name || "SessionEnd";
const every = threshold(event);

const root = projectRoot(input);
if (!fs.existsSync(path.join(root, ".docket"))) process.exit(0);

let text;
try {
  text = fs.readFileSync(input.transcript_path, "utf8");
} catch {
  process.exit(0);
}
const lines = countLines(text);

fs.mkdirSync(STATE_DIR, { recursive: true });
const session = input.session_id || path.basename(input.transcript_path, ".jsonl");
const stateFile = path.join(STATE_DIR, `${session}.json`);
// The runner for this session that is queued or running, if any.
const pendingFile = path.join(STATE_DIR, `${session}.pending`);
const reviewed = Math.min(readJson(stateFile, { entries: 0 }).entries || 0, lines);
if (lines - reviewed < every) process.exit(0);
if (event !== "SessionEnd" && isRunning(readJson(pendingFile, {}).pid)) process.exit(0);
if (!hasUserPrompt(text.split("\n").slice(reviewed, lines))) process.exit(0);

// The plugin's own `docket` goes first on the reviewer's PATH, so the commands
// the `remember` skill asks for resolve without any install: it runs the
// project's CLI, an installed one, or the pinned release through npx.
const env = { ...process.env, [REVIEW_ENV]: "1", PATH: `${PLUGIN_BIN}${path.delimiter}${process.env.PATH || ""}` };

const model = process.env.DOCKET_REVIEW_MODEL || DEFAULT_REVIEW_MODEL;

const log = fs.openSync(path.join(STATE_DIR, `${session}.log`), "a");
fs.writeSync(
  log,
  `\n--- ${new Date().toISOString()} ${event}: queued lines ${reviewed + 1}-${lines} of ${root} on ${model}\n`,
);

const job = {
  root,
  transcript: input.transcript_path,
  // What the reviewer records as where and when its evidence was observed.
  session,
  date: new Date().toISOString().slice(0, 10),
  model,
  from: reviewed,
  to: lines,
  stateFile,
  pendingFile,
  // One review per repository at a time; two agents editing .docket/ race.
  lockFile: path.join(STATE_DIR, `${checkoutKey(root)}.lock`),
};

const child = spawn(process.execPath, [path.join(__dirname, "review-runner.js")], {
  cwd: root,
  detached: true,
  stdio: ["ignore", log, log],
  env: { ...env, DOCKET_REVIEW_JOB: JSON.stringify(job) },
});
child.on("error", () => {});
child.unref();
if (child.pid) fs.writeFileSync(pendingFile, JSON.stringify({ pid: child.pid }));
process.exit(0);
