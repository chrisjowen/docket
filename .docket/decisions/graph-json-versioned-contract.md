---
id: decision.graph-json-versioned-contract
type: decision
title: "docket graph --json is the versioned graph contract for other tools"

links:
  - rel: uses
    target: library.docket-cli
    evidence:
      - source: code
        path: packages/docket/src/commands/graph.ts
        note: The graph command lives in the CLI.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: docs
    path: docs/graph-json.md
    lines: 1-30
    note: "Prints every exhibit and link as one JSON document under a schema name and version; read from the canonical files, read-only."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: README.md
    lines: 351-355
    note: "GET /api/graph returns the same graph without schema and version; scripts should read the command, whose contract is versioned."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# docket graph --json is the versioned graph contract for other tools

Tools that read a docket - such as Wheelhouse, which plans to chart each
project's docket - should run `docket graph --json` rather than parse
`.docket/` or call `docket open`'s `/api/graph`. The command merges files that
share an id and computes confidence exactly as `docket validate` does, reads
the canonical files rather than any index, writes nothing, and carries a
`schema` and `version` so consumers can detect breaking changes. Its full
contract is `docs/graph-json.md`.
