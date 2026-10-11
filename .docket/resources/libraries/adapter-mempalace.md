---
id: library.adapter-mempalace
type: library
title: MemPalace adapter (@docket/adapter-mempalace)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-mempalace"

links:
  - rel: depends_on
    target: system.mempalace
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/adapter-mempalace/src/config.ts
        lines: 18-23
        symbol: command
        note: Starts the MemPalace MCP server, mempalace-mcp on PATH by default.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: code
        path: packages/adapter-mempalace/src/mcp-client.ts
        lines: 1-5
        symbol: MCP_PROTOCOL_VERSION
        note: Speaks MCP 2025-06-18 over stdio; the comment says MemPalace 3.10.0 supports it.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-mempalace/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-mempalace/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-mempalace/package.json
    lines: 2-5
    key: description
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# MemPalace adapter

Files canonical inputs verbatim as drawers in one MemPalace wing and recalls
them through the MemPalace MCP server, which it starts as a child process and
talks to over stdio JSON-RPC. Not in the CLI's default bundle, like memvid.
