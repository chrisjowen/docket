---
id: system.postgres
type: system
title: PostgreSQL

attributes:
  category: storage
  vendor: PostgreSQL Global Development Group

evidence:
  - source: manifest
    path: packages/adapter-postgres/package.json
    lines: 30
    key: dependencies.pg
    note: "pg ^8.16.3."
    observedAt: 2026-11-18
    observedBy: claude

provenance:
  capturedBy: claude
---

# PostgreSQL

Relational database the optional Postgres adapter projects into and queries (full-text, pg_trgm, optional pgvector), version 16 or later; docket-server's canonical store runs on it too. Reached with a connection URL from an environment variable; docket never starts one.
