#!/usr/bin/env node
// SessionStart hook (SPEC §54).
// Injects docket context. Optionally runs one `docket sync` pass if the CLI is
// present. Never starts a daemon, never fails the session.

const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const CONTEXT = `This repository uses docket: local-first project knowledge,
captured and classified as Markdown.

Canonical knowledge is stored under \`.docket/\`.

\`.docket/entities.yaml\` defines the repository's resource types,
relationship types, attributes, and extraction guidance.

When durable project knowledge is needed, run \`docket search <query>\`
(\`npx --no-install docket search <query>\` if \`docket\` is not on the path)
and read the canonical files it points to. Grep \`.docket/\` only if
the CLI is unavailable or finds nothing.

When durable project knowledge is established or materially changed,
capture it by updating canonical files under \`.docket/\`.

Never edit \`.docket/.index/\`; it is generated.`;

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (!existsSync(path.join(root, ".docket"))) {
  process.exit(0);
}

try {
  // One reconciliation pass so projections reflect the checked-out branch.
  // The watcher (`docket watch`) owns continuous sync; this does not daemonize.
  execFileSync("npx", ["--no-install", "docket", "sync"], {
    cwd: root,
    stdio: "ignore",
    timeout: 20000,
  });
} catch {
  // CLI absent or sync failed. Not fatal: the docket files are still authoritative.
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: CONTEXT,
    },
  }),
);
