---
id: system.cognee
type: system
title: cognee server

attributes:
  category: storage

evidence:
  - source: code
    path: packages/adapter-cognee/src/cognee-client.ts
    lines: 85-90
    note: The adapter speaks cognee's REST API over HTTP, pinned to cognee 1.6.8.
    observedAt: 2026-11-13
    observedBy: claude
  - source: code
    path: packages/adapter-cognee/src/cognee-adapter.ts
    lines: 32-33
    symbol: PINNED_COGNEE
    observedAt: 2026-11-13
    observedBy: claude

provenance:
  capturedBy: claude
---

# cognee server

External agent-memory server the optional cognee adapter talks to over its REST API: it adds docket's inputs to a dataset, cognifies them into a knowledge graph with its own LLM and embedding models, and searches them. docket never starts it. Checked against a running cognee 1.6.8 (`cognee/cognee:1.6.8`).
