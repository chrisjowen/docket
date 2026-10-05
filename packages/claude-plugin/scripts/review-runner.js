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
    const reviewed = readJson(job.stateFile, { entries: 0 }).entries || 0;
    if (reviewed >= job.to) {
      log("already reviewed");
      return;
    }

    const code = await runClaude(job.claudeArgs, job.root);
    if (code === 0) {
      fs.writeFileSync(job.stateFile, JSON.stringify({ entries: job.to }));
    } else {
      log(`claude exited with ${code}; lines ${job.from + 1}-${job.to} stay unreviewed`);
    }
  } finally {
    unlock(job.lockFile);
  }
}

main().catch((cause) => {
  log(`review failed: ${cause && cause.stack ? cause.stack : cause}`);
  process.exitCode = 1;
});
