#!/usr/bin/env node
// SessionStart hook (SPEC §54).
// Injects docket context and starts one `docket sync` pass in the background,
// through npx when no CLI is installed. Outside a docket repository - such as
// a supervisor's home that manages other projects - it says only how to search
// the docket of a project Claude is asked about. Never starts a daemon, never
// blocks or fails the session.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { NPX_DOCKET, resolveDocket } = require("./cli.js");
const { CACHE_DIR, checkoutKey, isRunning, projectRoot, readJson } = require("./common.js");

const CONTEXT = `This repository uses docket: local-first project knowledge,
captured and classified as Markdown.

Canonical knowledge is stored under \`.docket/\`.

\`.docket/entities.yaml\` defines the repository's resource types,
relationship types, attributes, and extraction guidance.

When durable project knowledge is needed, run \`docket search <query>\`
(\`${NPX_DOCKET} search <query>\` if \`docket\` is not on
the path) and read the canonical files it points to. Grep \`.docket/\` only if
the CLI is unavailable or finds nothing.

The docket collects evidence continuously. Capture project knowledge as you
come across it, with the \`remember\` skill, without being asked and without
asking permission:

- the user states a decision, constraint, convention or owner
- you settle a decision or uncover a constraint
- the code, config or infrastructure you read shows a resource, attribute or
  dependency the docket lacks, or confirms or contradicts one it has

Search first, and add evidence to what the docket already has rather than
writing a new file. Capture at a natural pause, after the step you are on, and
say in one line what you wrote. Skip transient debugging state, speculation
and secrets. A background review also collects evidence from the transcript
as the session goes, so keep your attention on the task.

Never edit \`.docket/.index/\`; it is generated.`;

// Installed with the plugin and gone with it: nothing is written to any
// project's AGENTS.md or CLAUDE.md.
const PROJECTS_CONTEXT = `Projects you are asked about may keep a docket: their typed project
knowledge (services, decisions, constraints, owners, dependencies) as
Markdown under \`.docket/\`, with \`.docket.yaml\` at the clone's root.

When asked about a project whose clone has \`.docket.yaml\`, search its docket
before reading its code. If a docket MCP server is connected, call its
\`docket_search\` tool: it draws the matches and their links as a graph in
the chat. Only when no docket MCP server is connected, run
\`docket search <query>\` in that clone (\`${NPX_DOCKET} search <query>\`
if \`docket\` is not on the path). Then read the canonical files it names.`;

const root = projectRoot();

if (!fs.existsSync(path.join(root, ".docket"))) {
  emit(PROJECTS_CONTEXT);
  process.exit(0);
}

try {
  startSync(root);
} catch {
  // CLI absent or sync failed to start. Not fatal: the docket files are still authoritative.
}

emit(CONTEXT);

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    }),
  );
}

/**
 * One reconciliation pass so projections reflect the checked-out branch. It
 * runs detached: a large repository's first sync can outlast any hook timeout,
 * and a sync killed part-way never records its manifest, so it would start
 * over at every session. The watcher (`docket watch`) owns continuous sync;
 * this does not daemonize. A sync still running from an earlier session start
 * - after a compaction, say - is left to finish rather than joined by another.
 */
function startSync(root) {
  const lockDir = path.join(CACHE_DIR, "sync");
  const lockFile = path.join(lockDir, `${checkoutKey(root)}.json`);
  const running = readJson(lockFile, null);
  if (running && isRunning(running.pid)) return;

  const [command, args] = resolveDocket(root);
  const child = spawn(command, [...args, "sync"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.on("error", () => {});
  child.unref();

  if (child.pid) {
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid: child.pid }));
  }
}
