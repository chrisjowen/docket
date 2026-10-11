---
id: system.memvid
type: system
title: memvid CLI

attributes:
  category: storage

evidence:
  - source: code
    path: packages/adapter-memvid/src/config.ts
    lines: 26-29
    note: The adapter runs the memvid command, on PATH by default.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# memvid CLI

External CLI the optional memvid adapter shells out to, storing canonical inputs as frames of one `.mv2` file. Not bundled with docket and not installed by it.
