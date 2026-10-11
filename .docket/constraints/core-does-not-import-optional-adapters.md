---
id: constraint.core-does-not-import-optional-adapters
type: constraint
title: "Core must not import optional adapters"

links:
  - rel: governs
    target: library.docket-cli
    evidence:
      - source: docs
        path: docs/adapter-spec.md
        lines: 53
        note: "Core must not import all optional adapters or encode their configuration unions; each module exports an AdapterDefinition."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: governs
    target: library.adapter-neo4j
    evidence:
      - source: manifest
        path: packages/docket/package.json
        lines: 58-69
        note: "neo4j-driver and mem0ai are optional peer dependencies of the CLI."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: governs
    target: library.adapter-mem0
    evidence:
      - source: manifest
        path: packages/docket/package.json
        lines: 58-69
        note: "neo4j-driver and mem0ai are optional peer dependencies of the CLI."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: docs
    path: docs/adapter-spec.md
    lines: 44-60
    note: "Packages and loading: adapters are separate packages loaded as modules named in .docket.yaml; missing modules are never installed automatically."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/docket/scripts/bundle-packages.mjs
    lines: 1-13
    note: "Core loads bundled adapter packages as adapter modules and never imports them."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Core must not import optional adapters

Adapters are separate packages with their own engine dependencies, loaded
by module reference from `.docket.yaml` (a package, a project-relative
`.js`/`.mjs` file, or programmatic registration). The core validates only the
generic adapter envelope; each adapter validates its own configuration. Core
never imports an adapter, and engine drivers (`neo4j-driver`, `mem0ai`) are
optional peer dependencies, so a project pays only for the adapters it
configures. The CLI bundles jsonl, neo4j and mem0 copies for convenience
(`DOCKET_BUNDLED_ADAPTERS` can trim that); memvid and MemPalace are not
bundled. A missing module is an actionable error, never an automatic
install.
