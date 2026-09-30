#!/usr/bin/env node
// SessionStart hook (SPEC §54).
// Injects memory context. Optionally runs one `memory sync` pass if the CLI is
// present. Never starts a daemon, never fails the session.

const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const CONTEXT = `This repository uses local-first team memory.

Canonical memory is stored under \`.memory/\`.

\`.memory/entities.yaml\` defines the repository's resource types,
relationship types, attributes, and extraction guidance.

When durable project knowledge is needed, run \`memory search <query>\`
and read the canonical files it points to. Grep \`.memory/\` only if
the CLI is unavailable or finds nothing.

When durable project knowledge is established or materially changed,
capture it by updating canonical files under \`.memory/\`.

Never edit \`.memory/.index/\`; it is generated.`;

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (!existsSync(path.join(root, ".memory"))) {
  process.exit(0);
}

try {
  // One reconciliation pass so projections reflect the checked-out branch.
  // The watcher (`memory watch`) owns continuous sync; this does not daemonize.
  execFileSync("npx", ["--no-install", "memory", "sync"], {
    cwd: root,
    stdio: "ignore",
    timeout: 20000,
  });
} catch {
  // CLI absent or sync failed. Not fatal: memory files are still authoritative.
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: CONTEXT,
    },
  }),
);
