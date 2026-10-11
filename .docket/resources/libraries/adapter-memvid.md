---
id: library.adapter-memvid
type: library
title: memvid adapter (@docket/adapter-memvid)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-memvid"

links:
  - rel: depends_on
    target: system.memvid
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/adapter-memvid/src/config.ts
        lines: 26-29
        symbol: command
        note: Runs the memvid CLI, memvid on PATH by default.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: code
        path: packages/adapter-memvid/src/memvid-adapter.ts
        lines: 73
        symbol: spawnRunner
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-memvid/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-memvid/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-memvid/package.json
    lines: 2-5
    key: description
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# memvid adapter

Writes canonical inputs as frames of one `.mv2` file and searches them
lexically by spawning the memvid CLI. Not in the CLI's default bundle
(`bundle-packages.mjs` ships only jsonl, neo4j and mem0), so a project that
configures it must make the package resolvable itself.
