---
id: library.docket-cli
type: library
title: docket CLI and core (@chrisjowen/docket)

tags:
  - core

attributes:
  language: typescript
  package: "@chrisjowen/docket"

links:
  - rel: depends_on
    target: library.docket-contracts
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/docket/scripts/bundle-packages.mjs
        lines: 1-13
        symbol: directories
        note: The build copies @docket/contracts and @docket/adapter-kit into dist/bundled because core imports them and they are not published.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-adapter-kit
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/docket/scripts/bundle-packages.mjs
        lines: 1-13
        symbol: directories
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.adapter-jsonl
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/docket/scripts/bundle-packages.mjs
        lines: 23-25
        symbol: ADAPTERS
        note: jsonl is one of the three adapters bundled by default; docket init configures it as the "local" instance.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: config
        path: .docket.yaml
        lines: 23-27
        note: The init template configures @docket/adapter-jsonl as the local projection and query adapter.
        observedAt: 2026-10-11
        observedBy: claude
  - rel: depends_on
    target: library.adapter-neo4j
    attributes:
      runtime: true
      criticality: low
    evidence:
      - source: code
        path: packages/docket/scripts/bundle-packages.mjs
        lines: 23-25
        symbol: ADAPTERS
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.adapter-mem0
    attributes:
      runtime: true
      criticality: low
    evidence:
      - source: code
        path: packages/docket/scripts/bundle-packages.mjs
        lines: 23-25
        symbol: ADAPTERS
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-ui
    evidence:
      - source: manifest
        path: packages/docket/package.json
        lines: 45
        key: scripts.build
        note: The build runs scripts/copy-ui.mjs, copying the built UI into the package.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: docs
        path: README.md
        lines: 348-349
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: system.claude-code
    attributes:
      runtime: true
      criticality: low
    evidence:
      - source: code
        path: packages/docket/src/llm/claude-chat.ts
        lines: 33-45
        symbol: spawn('claude', args)
        note: Summaries for docket open's chat and docket ask run claude -p with no tools, no MCP servers and no saved session.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: system.ollama
    attributes:
      runtime: true
      criticality: low
    evidence:
      - source: code
        path: packages/docket/src/query/synthesis.ts
        lines: 55-60
        note: When summarize names a model without provider claude, answers are summarized through Ollama, http://localhost:11434 by default.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/docket/package.json
    lines: 2-3
    key: name
    note: Published as @chrisjowen/docket 0.4.0 with the docket bin at dist/cli.js.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/docket/src/cli.ts
    note: Commander entry point registering init, setup, watch, sync, rebuild, validate, search, ask, open, graph, runtime, adapter(s), config and ontology.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# docket CLI and core

The only published package. It is both the `docket` command
(`dist/cli.js`) and a library (`dist/index.js`), and it holds the whole core:
the canonical-file scanner and parser (`src/source`), ontology loading and
validation (`src/ontology`), evidence-weighted confidence (`src/evidence`),
the adapter loader (`src/adapters`), sync, rebuild and the watcher, the query
coordinator behind `docket ask`/`search` (`src/query`), the `docket open`
web server (`src/open`, port 4380 on 0.0.0.0) and the explicit docker-compose
runtime manager (`src/runtime`).

Its private workspace dependencies are not published: `scripts/bundle-packages.mjs`
copies contracts, adapter-kit and the jsonl, neo4j and mem0 adapters into
`dist/bundled` at build time. `mem0ai` and `neo4j-driver` are optional peer
dependencies, needed only by projects that configure those adapters.

Summaries are optional: without the `claude` CLI or an Ollama model, chat and
ask show unsummarized results.
