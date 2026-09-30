#!/usr/bin/env node
// Stop hook (SPEC §55).
// Reviews a substantial session for durable knowledge worth capturing, in the
// background: it starts a detached headless `claude -p` that reads the
// transcript and follows the `remember` skill, then returns at once so the
// interactive session is never interrupted. It does not create files itself;
// the review agent exercises judgement.

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ponytail: transcript growth is a crude proxy for "enough new to review".
// Replace with a real signal if it misfires.
const MIN_NEW_TRANSCRIPT_ENTRIES = 40;

const STATE_DIR = path.join(os.homedir(), ".cache", "team-memory", "reviews");

// Set in the review agent's environment so its own Stop hook stays quiet.
const REVIEW_ENV = "TEAM_MEMORY_REVIEW";

const prompt = (transcript, from) => `You are reviewing a finished stretch of a Claude Code session for durable project knowledge.

The session transcript is JSONL at:
${transcript}

Review only entries from line ${from + 1} onward; earlier lines were already reviewed.
Read it in chunks with the Read tool (offset/limit).

Read \`.memory/entities.yaml\`.

Determine whether that stretch established or materially changed:

- resource instances
- attributes
- relationships
- architectural decisions
- durable constraints
- significant conventions

If so, update the canonical \`.memory/\` files, following the \`remember\` skill.
Check existing memory first; the session may already have captured it.

Do not capture transient debugging details, unresolved speculation,
or ordinary conversational information.

If an important concept cannot be represented by the current ontology,
extend \`.memory/entities.yaml\` conservatively first.

Edit nothing outside \`.memory/\`. If nothing qualifies, say so in one line and stop.`;

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const input = readStdin();

if (process.env[REVIEW_ENV]) process.exit(0);
if (input.stop_hook_active) process.exit(0);

const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!fs.existsSync(path.join(root, ".memory"))) process.exit(0);

let entries = 0;
try {
  entries = fs.readFileSync(input.transcript_path, "utf8").split("\n").length;
} catch {
  process.exit(0);
}

fs.mkdirSync(STATE_DIR, { recursive: true });
const session = input.session_id || path.basename(input.transcript_path, ".jsonl");
const stateFile = path.join(STATE_DIR, `${session}.json`);
const reviewed = readJson(stateFile, { entries: 0 }).entries;
if (entries - reviewed < MIN_NEW_TRANSCRIPT_ENTRIES) process.exit(0);

// One review per repository at a time; two agents editing .memory/ race.
const repoKey = crypto.createHash("sha1").update(root).digest("hex").slice(0, 12);
const lockFile = path.join(STATE_DIR, `${repoKey}.lock`);
const lock = readJson(lockFile, null);
if (lock && isRunning(lock.pid)) process.exit(0);

const log = fs.openSync(path.join(STATE_DIR, `${session}.log`), "a");
fs.writeSync(log, `\n--- ${new Date().toISOString()} review lines ${reviewed + 1}-${entries} of ${root}\n`);

const args = [
  "-p",
  prompt(input.transcript_path, reviewed),
  "--permission-mode",
  "dontAsk",
  "--allowedTools",
  "Read",
  "Grep",
  "Glob",
  "Skill",
  "Bash(memory *)",
  "Edit(.memory/**)",
  "Write(.memory/**)",
];
if (process.env.TEAM_MEMORY_REVIEW_MODEL) {
  args.push("--model", process.env.TEAM_MEMORY_REVIEW_MODEL);
}

// Detached through a shell so the lock is released however the review ends.
const child = spawn(
  "/bin/sh",
  ["-c", 'claude "$@"; rm -f "$TEAM_MEMORY_LOCK"', "sh", ...args],
  {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, [REVIEW_ENV]: "1", TEAM_MEMORY_LOCK: lockFile },
  },
);
child.on("error", () => {});
child.unref();

fs.writeFileSync(lockFile, JSON.stringify({ pid: child.pid, session }));
fs.writeFileSync(stateFile, JSON.stringify({ entries }));
process.exit(0);
