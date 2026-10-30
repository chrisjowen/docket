---
id: library.adapter-neo4j
type: library
title: Neo4j adapter (@docket/adapter-neo4j)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-neo4j"

links:
  - rel: depends_on
    target: system.neo4j
    attributes:
      runtime: true
    evidence:
      - source: manifest
        path: packages/adapter-neo4j/package.json
        lines: 29
        key: dependencies.neo4j-driver
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: code
        path: packages/adapter-neo4j/src/config.ts
        lines: 6-20
        symbol: uri
        note: Connects by bolt uri; the password is read from the environment variable passwordEnv names.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-neo4j/package.json
        lines: 27
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-neo4j/package.json
        lines: 28
        key: dependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/adapter-neo4j/package.json
    lines: 2-5
    key: description
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/adapter-neo4j/src/cypher-search.ts
    symbol: graphOf
    note: The model-written Cypher path's graph block (relationships and paths among the rows, each edge citing its row's evidence) now also carries each edge's stored relationship confidence, when it is a number from 0 to 1. The default full-text path still returns no graph block.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/adapter-neo4j/src/cypher-search.test.ts
    symbol: shows relationships among the rows as a graph
    note: The graph-block unit test, run against a fake port with no Neo4j server, checks nodes, edges, each edge's row evidence and its confidence.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec

provenance:
  capturedBy: claude
---

# Neo4j adapter

Projects entities as a typed graph in Neo4j with a full-text index, and
answers questions full-text or through generated read-only Cypher, guarded by
`cypher-guard.ts`. Optional: bundled into the CLI by default, but needs the
`neo4j-driver` peer dependency and a reachable Neo4j, which `docket runtime`
can start from a `runtimes` entry.
