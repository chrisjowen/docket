---
id: library.adapter-postgres
type: library
title: Postgres adapter (@docket/adapter-postgres)

tags:
  - adapter

attributes:
  language: typescript
  package: "@docket/adapter-postgres"

links:
  - rel: depends_on
    target: system.postgres
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/adapter-postgres/src/config.ts
        lines: 19-21
        symbol: urlEnv
        note: "Connects with url, the URL in urlEnv, or the libpq environment, a password read from passwordEnv."
        observedAt: 2026-11-18
        observedBy: claude
  - rel: depends_on
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-postgres/package.json
        lines: 28
        key: dependencies.@docket/adapter-kit
        observedAt: 2026-11-18
        observedBy: claude
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/adapter-postgres/package.json
        lines: 29
        key: dependencies.@docket/contracts
        observedAt: 2026-11-18
        observedBy: claude

evidence:
  - source: manifest
    path: packages/adapter-postgres/package.json
    lines: 2-5
    key: description
    observedAt: 2026-11-18
    observedBy: claude

provenance:
  capturedBy: claude
---

# Postgres adapter

Projects entities and their links into tables of its own in Postgres 16 or later and answers with full-text matches (`websearch_to_tsquery`, BM25 over weighted vectors, a pg_trgm title lift), optionally pgvector cosine similarity fused by reciprocal rank, and the best paths from each match found by a recursive query under the Neo4j adapter's ranking rules. Opt-in: jsonl stays docket's default. The CLI bundles it, and exports it as `@chrisjowen/docket/adapters/postgres`.
