---
id: library.adapter-mem0
type: library
title: mem0 adapter (@docket/adapter-mem0)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-mem0"

links:
  - rel: depends_on
    target: system.mem0
    attributes:
      runtime: true
    evidence:
      - source: manifest
        path: packages/adapter-mem0/package.json
        lines: 29
        key: dependencies.mem0ai
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: code
        path: packages/adapter-mem0/src/config.ts
        lines: 27-56
        symbol: mode
        note: Three modes - platform (hosted, key from MEM0_API_KEY by default), oss (mem0ai/oss in process) and server (a self-hosted mem0 server URL).
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-mem0/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-mem0/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-mem0/package.json
    lines: 2-5
    key: description
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# mem0 adapter

Stores one verbatim memory per entity in mem0 - hosted (`platform`), a
self-hosted mem0 server (`server`) or in-process `mem0ai/oss` - and queries it
semantically. API keys are named by environment variable, never written to
`.docket.yaml`. Optional: bundled into the CLI by default, but needs the
`mem0ai` peer dependency.
