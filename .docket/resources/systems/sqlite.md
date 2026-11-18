---
id: system.sqlite
type: system
title: SQLite

attributes:
  category: storage
  vendor: SQLite

evidence:
  - source: manifest
    path: packages/adapter-sqlite/package.json
    lines: 30
    key: dependencies.better-sqlite3
    note: "better-sqlite3 ^12.6.2, which embeds SQLite with FTS5."
    observedAt: 2026-11-18
    observedBy: claude

provenance:
  capturedBy: claude
---

# SQLite

Embedded database the optional SQLite adapter keeps its index in: one file, no server, through better-sqlite3.
