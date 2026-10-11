---
id: system.mempalace
type: system
title: MemPalace MCP server

attributes:
  category: storage

evidence:
  - source: code
    path: packages/adapter-mempalace/src/config.ts
    lines: 18-23
    note: The adapter starts mempalace-mcp (or python3 -m mempalace.mcp_server) over stdio.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/adapter-mempalace/src/mcp-client.ts
    lines: 4-5
    note: MCP protocol 2025-06-18; the source says MemPalace 3.10.0 supports it.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# MemPalace MCP server

External memory server the optional MemPalace adapter talks to over MCP on stdio. The 3.10.0 compatibility claim comes from a code comment and has not been checked against a running server.
