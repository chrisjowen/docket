#!/usr/bin/env node
// Runs one background review, detached from the session that asked for it
// (see session-end-review.js, which passes the job in DOCKET_REVIEW_JOB).
//
// It waits its turn on the repository's review lock, so a session that ends
// while another session's review is running is reviewed afterwards rather than
// skipped. The transcript lines count as reviewed only once `claude` exits
// cleanly, so a missing, signed-out or failing `claude` leaves them for the
// next review of that session.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { isRunning, readJson } = require("./common.js");

// ponytail: a fixed wait. A review that outlasts it is skipped, not queued.
const LOCK_WAIT_MS = Number(process.env.DOCKET_REVIEW_LOCK_WAIT_MS) || 30 * 60 * 1000;
const LOCK_POLL_MS = Number(process.env.DOCKET_REVIEW_LOCK_POLL_MS) || 5000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const prompt = (job, from) => `You are reviewing a finished stretch of a Claude Code session for durable project knowledge.

The session transcript is JSONL at:
${job.transcript}

Review only lines ${from + 1} to ${job.to}; earlier lines were already reviewed.
Read them in chunks with the Read tool (offset/limit).

Read \`.docket/entities.yaml\`.

Determine whether that stretch established or materially changed:

- resource instances
- attributes
- relationships
- architectural decisions
- durable constraints
- significant conventions

If so, update the canonical \`.docket/\` files, following the \`remember\` skill.
Check the existing docket first; the session may already have captured it.
Run the CLI as \`docket\`, or as \`npx --no-install docket\` if \`docket\` is not found.

Record evidence for every resource and every link you write, as the
\`remember\` skill describes: the source kind and the exact place the session
saw it - file path, line range and symbol; config key; API method and endpoint;
URL - or, for something the user said, \`source: conversation\` with a note of
what was said. Take the location from the transcript: the file the session
read, the command it ran, the URL it opened. Use \`observedBy: claude\`,
\`observedAt: ${job.date}\` and \`session: ${job.session}\`. Never write a
confidence; docket computes it from the evidence.

When the docket already has a resource or link the session saw again, append an
evidence entry to it. Never edit or remove existing evidence.

Write a body that describes the resource properly - what it is and does, how
it is used or configured, and how it was found - not a one-line label.

Do not capture transient debugging details, unresolved speculation,
or ordinary conversational information.

Never capture credentials, secrets, tokens, private keys or passwords, even
when they appear in the transcript. The docket is committed to the repository
and may be sent to remote projections. Record that a secret exists and where
it is managed, never its value.

If an important concept cannot be represented by the current ontology,
extend \`.docket/entities.yaml\` conservatively first.

Edit nothing outside \`.docket/\`. If nothing qualifies, say so in one line and stop.`;

function claudeArgs(job, from) {
  return [
    "-p",
    prompt(job, from),
    "--model",
    job.model,
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read",
    "Grep",
    "Glob",
    "Skill",
    "Bash(docket *)",
    "Bash(npx --no-install docket *)",
    // Read-only, for pinning evidence to a commit and building permalinks.
    "Bash(git rev-parse *)",
    "Bash(git remote get-url *)",
    "Edit(.docket/**)",
    "Write(.docket/**)",
  ];
}

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/** Exclusive create, so two runners can never both believe they hold the lock. */
function tryLock(lockFile) {
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), { flag: "wx" });
    return true;
  } catch (cause) {
    if (cause.code !== "EEXIST") throw cause;
  }
  const holder = readJson(lockFile, null);
  if (holder && isRunning(holder.pid)) return false;
  // Left by a review that died. Remove it only if it is still the one just read.
  try {
    if (fs.readFileSync(lockFile, "utf8") === JSON.stringify(holder)) fs.unlinkSync(lockFile);
  } catch {}
  return false;
}

function unlock(lockFile) {
  try {
    if (readJson(lockFile, null)?.pid === process.pid) fs.unlinkSync(lockFile);
  } catch {}
}

function runClaude(args, cwd) {
  return new Promise((done) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (cause) => {
      log(`could not start claude: ${cause.message}`);
      done(1);
    });
    child.on("exit", (code, signal) => done(signal ? 1 : code));
  });
}

async function main() {
  const job = JSON.parse(process.env.DOCKET_REVIEW_JOB);
  delete process.env.DOCKET_REVIEW_JOB;

  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!tryLock(job.lockFile)) {
    if (Date.now() > deadline) {
      log("another review held the lock for too long; skipped");
      return;
    }
    await sleep(LOCK_POLL_MS);
  }

  try {
    // A review of this session may have finished while this one waited.
    const from = Math.max(job.from, readJson(job.stateFile, { entries: 0 }).entries || 0);
    if (from >= job.to) {
      log("already reviewed");
      return;
    }

    log(`reviewing lines ${from + 1}-${job.to}`);
    const code = await runClaude(claudeArgs(job, from), job.root);
    if (code === 0) {
      fs.writeFileSync(job.stateFile, JSON.stringify({ entries: job.to }));
    } else {
      log(`claude exited with ${code}; lines ${from + 1}-${job.to} stay unreviewed`);
    }
  } finally {
    unlock(job.lockFile);
  }
}

main().catch((cause) => {
  log(`review failed: ${cause && cause.stack ? cause.stack : cause}`);
  process.exitCode = 1;
});
