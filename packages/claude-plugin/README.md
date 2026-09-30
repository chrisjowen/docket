# team-memory Claude Code plugin

Teaches Claude how this repository's local-first team memory works: where
canonical memory lives, how to read the ontology, what deserves durable
capture, and how to extend the model.

The plugin owns agent behaviour only. Indexing, filesystem synchronization and
projection lifecycle belong to the `memory` CLI (`@team-memory/cli`), which is
a separate artifact.

## Contents

| Path | Purpose |
|---|---|
| `skills/team-memory/SKILL.md` | Read and write memory under `.memory/` |
| `skills/remember/SKILL.md` | Explicit "remember this" capture |
| `skills/ontology/SKILL.md` | Inspect and extend `.memory/entities.yaml` |
| `hooks/hooks.json` | SessionStart context injection, Stop review |
| `scripts/session-start.js` | Injects memory context, best-effort `memory sync` |
| `scripts/stop-review.js` | Prompts an end-of-session memory review |

## Installation

The repository root is a plugin marketplace
(`.claude-plugin/marketplace.json`) listing this plugin:

```text
/plugin marketplace add chrisjowen/team-memory
/plugin install team-memory@team-memory
```

For local development, add a checkout instead:

```text
/plugin marketplace add /path/to/team-memory
/plugin install team-memory@team-memory
```

## CLI

The plugin does not install the CLI and does not modify the repository's
dependencies. Add it to the target repository yourself:

```json
{
  "devDependencies": {
    "@team-memory/cli": "^0.1.0"
  },
  "scripts": {
    "memory:watch": "memory watch",
    "memory:sync": "memory sync",
    "memory:validate": "memory validate"
  }
}
```

Then `memory init` once, and run `npm run memory:watch` during development.
The skills degrade gracefully when the CLI is absent: memory files are
authoritative with or without it.

## Projection

Projection is driven by the filesystem watcher, never by tool hooks. Agents
edit Markdown under `.memory/`; `memory watch` reconciles `.memory/.index/`.
This keeps edits from Claude, humans, scripts, `git pull` and merges on one
path.
