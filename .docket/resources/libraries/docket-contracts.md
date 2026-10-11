---
id: library.docket-contracts
type: library
title: "@docket/contracts"

attributes:
  language: typescript
  package: "@docket/contracts"

evidence:
  - source: manifest
    path: packages/contracts/package.json
    lines: 2
    key: name
    note: Private workspace package; its only dependency is zod.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: docs/adapter-spec.md
    lines: 48
    note: Types, runtime validators and contract test helpers, with no engine drivers or UI dependencies.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# @docket/contracts

The adapter contract: TypeScript types and zod runtime validators for adapter
definitions, projection records and query answers, plus contract test
helpers. Core, the adapter kit, every adapter and the web UI depend on it, so
it is the seam that lets adapters live in separate packages. Not published;
the CLI bundles a copy.
