---
id: system.ollama
type: system
title: Ollama

attributes:
  category: llm

evidence:
  - source: code
    path: packages/docket/src/query/synthesis.ts
    lines: 55-60
    note: summarize.model without provider claude summarizes through Ollama at http://localhost:11434 by default.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/adapter-kit/src/ollama-chat.ts
    lines: 6
    note: Default url http://localhost:11434.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Ollama

An optional local model server for answer summaries, chosen by setting `summarize.model` in `.docket.yaml` (e.g. `qwen2.5:7b`). Also appears in the commented mem0 self-hosted example as an embedder and LLM provider. Nothing requires it.
