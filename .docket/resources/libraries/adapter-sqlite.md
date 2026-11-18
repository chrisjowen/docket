---
id: library.adapter-sqlite
type: library
title: SQLite adapter (@docket/adapter-sqlite)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-sqlite"

links:
  - rel: depends_on
    target: system.sqlite
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/adapter-sqlite/src/config.ts
        lines: 18
        symbol: file
        note: "Keeps its index in one SQLite file: file, or index.sqlite in the instance's own state directory."
        observedAt: 2026-11-18
        observedBy: claude
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-sqlite/package.json
        lines: 28
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-11-18
        observedBy: claude
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-sqlite/package.json
        lines: 29
        key: dependencies.@docket/contracts
        observedAt: 2026-11-18
        observedBy: claude

evidence:
  - source: manifest
    path: packages/adapter-sqlite/package.json
    lines: 2-5
    key: description
    observedAt: 2026-11-18
    observedBy: claude

provenance:
  capturedBy: claude
---

# SQLite adapter

Projects entities and their links into one SQLite file and answers with FTS5 BM25 matches, optionally embedding cosine similarity fused by reciprocal rank, and the best paths from each match found by a recursive query under the Neo4j adapter's ranking rules. Needs no server. Opt-in: jsonl stays docket's default. The CLI bundles it, and exports it as `@chrisjowen/docket/adapters/sqlite`.
