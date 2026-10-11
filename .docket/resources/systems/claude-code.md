---
id: system.claude-code
type: system
title: Claude Code (claude CLI)

attributes:
  category: llm
  vendor: Anthropic

evidence:
  - source: code
    path: packages/docket/src/llm/claude-chat.ts
    lines: 33-45
    note: Core spawns claude -p for answer summaries.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/claude-plugin/scripts/review-runner.js
    lines: 139
    note: The plugin spawns claude for background evidence reviews.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Claude Code (claude CLI)

The `claude` CLI, used two ways: by the docket core to summarize `docket ask` and `docket open` chat answers in print mode with no tools, MCP servers or saved session (optional - Ollama is the alternative and unsummarized results the fallback), and by the Claude Code plugin, which runs inside it and spawns it again for background reviews. It uses the user's own login; docket configures no key.
