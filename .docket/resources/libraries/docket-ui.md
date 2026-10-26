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
