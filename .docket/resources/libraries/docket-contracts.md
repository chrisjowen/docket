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
  - source: code
    path: packages/contracts/src/types.ts
    symbol: GraphEdge
    note: GraphEdge gains an optional, additive confidence (0 to 1) beside its evidenceIds; GraphBlock already held nodes, edges and ordered paths.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/contracts/src/schemas.ts
    symbol: resultBlockSchema
    note: The graph block's edge validator accepts an optional confidence from 0 to 1; the looseObject schemas keep the change additive.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/contracts/src/validate.test.ts
    note: A test checks a graph edge confidence of 0.9 validates and 1.5 is rejected.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec

provenance:
  capturedBy: claude
---

# @docket/contracts

The adapter contract: TypeScript types and zod runtime validators for adapter
definitions, projection records and query answers, plus contract test
helpers. Core, the adapter kit, every adapter and the web UI depend on it, so
it is the seam that lets adapters live in separate packages. Not published;
the CLI bundles a copy.
