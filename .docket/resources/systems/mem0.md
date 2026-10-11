---
id: system.mem0
type: system
title: mem0

attributes:
  category: storage
  vendor: mem0

evidence:
  - source: manifest
    path: packages/adapter-mem0/package.json
    lines: 29
    key: dependencies.mem0ai
    note: mem0ai ^3.3.1.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# mem0

Memory store behind the optional mem0 adapter: the hosted platform (app.mem0.ai, key from `MEM0_API_KEY`), a self-hosted mem0 server, or the in-process `mem0ai/oss` library with its own embedder, vector store and LLM.
