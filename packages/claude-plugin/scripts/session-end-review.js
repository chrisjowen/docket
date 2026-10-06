#!/usr/bin/env node
// SessionEnd hook (SPEC §55).
// When a session ends, reviews the part of it no review has seen yet for
// durable knowledge worth capturing. The review runs in the background: this
// starts a detached runner (`review-runner.js`) that drives a headless
// `claude -p` over the transcript, following the `remember` skill, and returns
// at once so ending the session is never delayed. It does not create files
// itself; the review agent exercises judgement.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  CACHE_DIR,
  DEFAULT_REVIEW_MODEL,
  checkoutKey,
  localDocketBin,
  projectRoot,
  readJson,
  readStdin,
} = require("./common.js");

const STATE_DIR = path.join(CACHE_DIR, "reviews");

// Set in the review agent's environment so its own SessionEnd hook stays quiet.
const REVIEW_ENV = "DOCKET_REVIEW";

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
const reviewed = Math.min(readJson(stateFile, { entries: 0 }).entries || 0, lines);
if (lines <= reviewed) process.exit(0);
if (!hasUserPrompt(text.split("\n").slice(reviewed, lines))) process.exit(0);

// The project's own CLI goes first on the reviewer's PATH, so the `docket`
// commands the `remember` skill asks for resolve without a global install.
const bin = localDocketBin(root);
const env = { ...process.env, [REVIEW_ENV]: "1" };
if (bin) env.PATH = `${path.dirname(bin)}${path.delimiter}${env.PATH || ""}`;

const model = process.env.DOCKET_REVIEW_MODEL || DEFAULT_REVIEW_MODEL;

const log = fs.openSync(path.join(STATE_DIR, `${session}.log`), "a");
fs.writeSync(
  log,
  `\n--- ${new Date().toISOString()} session end: queued lines ${reviewed + 1}-${lines} of ${root} on ${model}\n`,
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
process.exit(0);
