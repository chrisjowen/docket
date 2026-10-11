---
id: constraint.node-22
type: constraint
title: "docket requires Node 22 or later"

links:
  - rel: governs
    target: library.docket-cli
    evidence:
      - source: manifest
        path: packages/docket/package.json
        lines: 38-40
        note: "engines.node >=22"
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: governs
    target: agent.docket-claude-plugin
    evidence:
      - source: docs
        path: README.md
        lines: 213-216
        note: "The plugin runs the CLI through npx, so Node 22 or later is still needed."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 14-17
    note: "CI and publish run on Node 22."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: README.md
    lines: 191
    note: "Node 22 or later."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# docket requires Node 22 or later

The published CLI declares `engines.node >=22`, CI and the publish workflow
build and test on Node 22, and the plugin, which runs the CLI through `npx`
when none is installed, needs it too. Older Node versions are unsupported.
