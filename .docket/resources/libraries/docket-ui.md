---
id: library.docket-ui
type: library
title: docket web UI (@chrisjowen/docket-ui)

attributes:
  language: typescript
  package: "@chrisjowen/docket-ui"

links:
  - rel: depends_on
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/docket-ui/package.json
        lines: 16
        key: devDependencies.@docket/contracts
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/docket-ui/package.json
    lines: 2
    key: name
    note: Private SvelteKit 2 / Svelte 5 app with adapter-static, Tailwind 4 and d3-force.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: README.md
    lines: 348-349
    note: Built into the npm package, so a global install of @chrisjowen/docket is all docket open needs.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: code
    path: packages/docket-ui/src/lib/sync.svelte.ts
    lines: 5-88
    symbol: sync UI component
    note: The UI now has a sync capability that launches docket sync from within docket open, polls GET /api/sync every 500ms while the sync runs, and caches adapter freshness while running to avoid recomputing snapshots on each poll.
    observedAt: 2026-10-26
    observedBy: claude
    session: 545488c7-b406-402b-8f89-e4d88e865c28
    commit: b74099f
  - source: code
    path: packages/docket-ui/src/mcp-app/app.svelte
    symbol: docket_search MCP app
    note: The docket_search MCP app is a Svelte component that draws the resources matched by docket search on the casebook's evidence board, with subgraphs adapters returned at full strength and canonical one-hop neighbours faded as context.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/docket-ui/src/mcp-app/board.ts
    symbol: boardOf, hasSubgraph, searchOf, typeColours
    note: boardOf turns a docket-search.v1 result into graph-view nodes and links; when hasSubgraph finds an adapter-returned subgraph, its emphasis keeps it at full strength and fades the via-canonical context.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: docs
    path: docs/mcp.md
    note: Comprehensive documentation of the MCP server contract, transport, tool specification and the MCP app UI, including the docket-search.v1 structured content format and how adapters return graph blocks with paths, confidence and evidence.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec

provenance:
  capturedBy: claude
---

# docket web UI

The browser front end of `docket open`: graph, inspector, quick search,
table and history views, Ask, Adapters and Chat. It is a static SvelteKit
build (`@sveltejs/adapter-static`) that the CLI build copies into its own
`dist`, served by the CLI's HTTP server and reading its JSON API
(`/api/graph`, `/api/ask`, `/api/adapters`, `/api/evidence`). It is never
published or deployed on its own.
