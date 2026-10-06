// Helpers shared by the hook scripts. Plain CommonJS with no dependencies: the
// plugin ships as files, without a node_modules of its own.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Where hook bookkeeping lives - review state, logs and locks. */
const CACHE_DIR = path.join(os.homedir(), ".cache", "docket");

/** The model the background review runs on unless `DOCKET_REVIEW_MODEL` names another. */
const DEFAULT_REVIEW_MODEL = "haiku";

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

/**
 * The project the session belongs to. `CLAUDE_PROJECT_DIR` stays put for the
 * whole session, while the hook's `cwd` follows every `cd` Claude runs, so it
 * comes first.
 */
function projectRoot(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}

/**
 * Resolves symlinks and, on case-insensitive filesystems, the on-disk letter
 * case, so one checkout reached through different spellings of its path
 * always gets the same lock.
 */
function canonicalPath(dir) {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** A short stable key for one checkout, for lock and state file names. */
function checkoutKey(root) {
  return crypto.createHash("sha1").update(canonicalPath(root)).digest("hex").slice(0, 12);
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: alive, but owned by another user.
    return cause.code === "EPERM";
  }
}

module.exports = {
  CACHE_DIR,
  DEFAULT_REVIEW_MODEL,
  canonicalPath,
  checkoutKey,
  isRunning,
  projectRoot,
  readJson,
  readStdin,
};
