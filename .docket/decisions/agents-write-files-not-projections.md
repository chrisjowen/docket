---
id: decision.agents-write-files-not-projections
type: decision
title: "Agents write canonical files, never projection backends"

links:
  - rel: documented_in
    target: document.docket-spec
    evidence:
      - source: docs
        path: docs/SPEC.md
        lines: 85-111
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: docs
    path: docs/SPEC.md
    lines: 85-111
    note: "2.4 Agents write files, not databases: agent -> .docket/ file -> watcher -> projection."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: docs/SPEC.md
    lines: 1944-1970
    note: "56: do not use PostToolUse hooks to update indexes; the filesystem watcher is responsible for projection."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: config
    path: packages/claude-plugin/hooks/hooks.json
    lines: 1-47
    note: "The plugin registers SessionStart, Stop, PreCompact and SessionEnd hooks only - no PostToolUse."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Agents write canonical files, never projection backends

Claude, any other agent and humans persist knowledge only by editing files
under `.docket/`; nothing writes to a projection backend directly. Projection
happens through `docket sync`, `docket watch` or `docket rebuild`, so edits
from every tool are handled the same way. The Claude Code plugin follows
this: it has no PostToolUse hook, and its background review writes files
through the `remember` skill.
