---
id: library.docket-adapter-kit
type: library
title: "@docket/adapter-kit"

attributes:
  language: typescript
  package: "@docket/adapter-kit"

links:
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-kit/package.json
        lines: 30
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-kit/package.json
    lines: 2-5
    key: description
    note: What docket's own adapters share - the entity-projection adapter, checkout scopes, stable JSON, atomic writes and the Ollama chat client.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/adapter-kit/src/ollama-chat.ts
    lines: 29
    symbol: ollamaChat
    note: Shared helpers adapters and core reuse, including the Ollama chat client.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# @docket/adapter-kit

Shared building blocks for writing adapters on top of `@docket/contracts`:
helpers every adapter package depends on, and utilities core reuses such as
the Ollama chat client used for summaries. Not published; the CLI bundles a
copy.
