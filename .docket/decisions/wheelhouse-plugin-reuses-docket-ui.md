---
id: decision.wheelhouse-plugin-reuses-docket-ui
type: decision
title: docket's Wheelhouse plugin draws docket-ui's own casebook, talking to docket open

tags:
  - wheelhouse
  - docket-ui

links:
  - rel: uses
    target: library.docket-ui
    evidence:
      - source: code
        path: packages/docket-ui/src/embed/element.svelte.ts
        symbol: DocketCasebookElement
        note: The <docket-casebook> element mounts docket-ui's casebook shell in a shadow root, with its API at the viewer's address and views in memory.
        observedAt: 2026-10-29
        observedBy: claude
        session: d4ae1baf-edac-4b06-879f-17233cf56f20
  - rel: uses
    target: decision.docket-open-allow-origin
    evidence:
      - source: code
        path: wheelhouse/src/server.ts
        lines: 221
        symbol: viewer
        note: The plugin's viewer service starts docket open on 127.0.0.1 with --allow-origin for each configured Wheelhouse origin.
        observedAt: 2026-10-29
        observedBy: claude
        session: d4ae1baf-edac-4b06-879f-17233cf56f20

evidence:
  - source: manifest
    path: .wheelhouse-plugin/plugin.json
    key: wheelhouse.contributions
    note: The docket repository is an installable Wheelhouse plugin (id docket) with one project.tab contribution and one project-scoped viewer service.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20
  - source: docs
    path: wheelhouse/README.md
    note: Documents full parity with docket open's views and actions, the settings (bin, roots, ports, origins), and that built files are committed and checked by tests.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20
  - source: conversation
    note: The captain chose full parity - every view and action of docket open inside Wheelhouse - over Wheelhouse's earlier read-only Chart.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20

provenance:
  capturedBy: claude
---

# The Wheelhouse plugin reuses docket-ui

The docket repository ships a Wheelhouse plugin (`.wheelhouse-plugin/plugin.json`,
`wheelhouse/`). Its Docket project tab is `<docket-casebook>`, built from
`packages/docket-ui/src/embed`: the same casebook shell docket open's page
draws, so parity holds by construction rather than by a second implementation.

The element reads and asks everything of the project's `docket open`, which
Wheelhouse starts as the plugin's `viewer` service with `--allow-origin` for
Wheelhouse's page. Wheelhouse providers are read-only and take no input, so
interactive actions (Ask, sync, evidence) must go from the page to the viewer.

The built server entry and UI bundle are committed, because Wheelhouse imports
them without building; `pnpm -C wheelhouse test` fails when they are stale.
A Wheelhouse with its own built-in Docket plugin refuses this one until that
is removed there.
