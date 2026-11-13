---
id: library.adapter-cognee
type: library
title: cognee adapter (@docket/adapter-cognee)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-cognee"

links:
  - rel: depends_on
    target: system.cognee
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/adapter-cognee/src/config.ts
        lines: 17-23
        symbol: url
        note: Connects to the cognee server at url, with an API key read from apiKeyEnv.
        observedAt: 2026-11-13
        observedBy: claude
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-cognee/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-11-13
        observedBy: claude
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-cognee/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-11-13
        observedBy: claude

evidence:
  - source: manifest
    path: packages/adapter-cognee/package.json
    lines: 2-5
    key: description
    observedAt: 2026-11-13
    observedBy: claude

provenance:
  capturedBy: claude
---

# cognee adapter

Adds canonical inputs to one cognee dataset, with each input's identity in the data item's external metadata, cognifies them into cognee's knowledge graph, and answers with cognee's chunk search - and, when configured, its cited completion - through the cognee REST API. The CLI bundles it, and exports it as `@chrisjowen/docket/adapters/cognee`.
