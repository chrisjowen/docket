#!/usr/bin/env node
// Stop hook (SPEC §55).
// Asks the model to review a substantial session for durable knowledge worth
// capturing. It does not create files itself; the model exercises judgement.

const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

// ponytail: transcript length is a crude proxy for "substantial session".
// Replace with a real signal if it misfires.
const SUBSTANTIAL_TRANSCRIPT_ENTRIES = 20;

const PROMPT = `Review the session for durable project knowledge.

Read \`.memory/entities.yaml\`.

Determine whether this session established or materially changed:

- resource instances
- attributes
- relationships
- architectural decisions
- durable constraints
- significant conventions

If so, update the canonical \`.memory/\` files before completing.

Do not capture transient debugging details, unresolved speculation,
or ordinary conversational information.

If an important concept cannot be represented by the current ontology,
extend \`.memory/entities.yaml\` conservatively first.

If nothing in this session qualifies, say so in one line and stop.`;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const input = readStdin();

// Already reviewed once this stop; never loop.
if (input.stop_hook_active) process.exit(0);

const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!existsSync(path.join(root, ".memory"))) process.exit(0);

let entries = 0;
try {
  entries = readFileSync(input.transcript_path, "utf8").split("\n").length;
} catch {
  process.exit(0);
}
if (entries < SUBSTANTIAL_TRANSCRIPT_ENTRIES) process.exit(0);

process.stdout.write(JSON.stringify({ decision: "block", reason: PROMPT }));
