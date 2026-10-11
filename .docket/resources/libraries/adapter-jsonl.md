---
id: library.adapter-jsonl
type: library
title: JSONL adapter (@docket/adapter-jsonl)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-jsonl"

links:
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-jsonl/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-jsonl/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-jsonl/package.json
    lines: 2-5
    key: description
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: config
    path: .docket.yaml
    lines: 23-27
    note: Configured by docket init as the local projection and query adapter.
    observedAt: 2026-10-11
    observedBy: claude

provenance:
  capturedBy: claude
---

# JSONL adapter

The default adapter and the only one `docket init` enables (as the `local`
instance): it writes merged entities as JSONL under `.docket/.index`
(`documents.jsonl`, `nodes.jsonl`, `edges.jsonl` plus a sync manifest) and
answers queries with lexical search. It needs no service or network, which is
why `docket open` and `docket graph --json` work with nothing else configured.
Bundled into the CLI by default.
