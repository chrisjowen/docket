---
id: system.neo4j
type: system
title: Neo4j

attributes:
  category: storage
  vendor: Neo4j

evidence:
  - source: manifest
    path: packages/adapter-neo4j/package.json
    lines: 29
    key: dependencies.neo4j-driver
    note: neo4j-driver ^6.2.0.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Neo4j

Graph database the optional Neo4j adapter projects into and queries (full-text and generated read-only Cypher). Reached over bolt with the password from an environment variable; the docket runtime manager can start it locally with docker compose.
