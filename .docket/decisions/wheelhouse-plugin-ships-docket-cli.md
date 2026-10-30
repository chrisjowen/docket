---
id: decision.wheelhouse-plugin-ships-docket-cli
type: decision
title: docket's Wheelhouse plugin ships and runs the docket CLI built from its own commit

tags:
  - wheelhouse
  - packaging

links:
  - rel: uses
    target: library.docket-cli
    evidence:
      - source: code
        path: wheelhouse/build.mjs
        lines: 111-190
        symbol: shippedDocket
        note: Copies packages/docket/dist (no maps or .d.ts) into wheelhouse/docket/, bundles docket's npm dependencies into dist/vendor/ and rewrites their imports; peer drivers stay imports. pnpm check fails on any drift or stray file.
        observedAt: 2026-10-31
        observedBy: claude
        session: db7232ae-da49-4682-9743-5f577fc5b78e
  - rel: uses
    target: library.docket-ui
    evidence:
      - source: config
        path: packages/docket-ui/svelte.config.js
        lines: 20
        key: kit.version.name
        note: SvelteKit's version name is pinned to docket's package version instead of the build time, so the committed copy of the web UI builds identically and can be drift-checked.
        observedAt: 2026-10-31
        observedBy: claude
        session: db7232ae-da49-4682-9743-5f577fc5b78e
  - rel: uses
    target: decision.wheelhouse-plugin-reuses-docket-ui
    evidence:
      - source: code
        path: wheelhouse/src/server.ts
        lines: 186-247
        symbol: shippedCli
        note: The viewer service runs [process.execPath, wheelhouse/docket/dist/cli.js, open, ...] unless settings.bin names another docket CLI.
        observedAt: 2026-10-31
        observedBy: claude
        session: db7232ae-da49-4682-9743-5f577fc5b78e

evidence:
  - source: code
    path: wheelhouse/src/server.ts
    lines: 163-247
    symbol: docketCli
    note: Without "bin" the plugin runs the docket it ships with Wheelhouse's own node and asks it nothing; with "bin" (an absolute path or a command name on PATH) it asks docket --version and docket open --help. The casebook data carries the version, which the tab shows.
    observedAt: 2026-10-31
    observedBy: claude
    session: db7232ae-da49-4682-9743-5f577fc5b78e
  - source: docs
    path: wheelhouse/README.md
    lines: 108-131
    note: The section The docket it runs says updating the plugin brings the matching docket, nothing is installed globally, and the docket on PATH is used only when bin names it.
    observedAt: 2026-10-31
    observedBy: claude
    session: db7232ae-da49-4682-9743-5f577fc5b78e
  - source: conversation
    note: The captain asked that a plugin update also install the latest docket, after the plugin had moved to a newer commit while the docket on PATH stayed at the published 0.5.0, which lacked the fix the plugin's search app needed.
    observedAt: 2026-10-31
    observedBy: claude
    session: db7232ae-da49-4682-9743-5f577fc5b78e

provenance:
  capturedBy: claude
---

# The Wheelhouse plugin ships the docket it runs

docket's Wheelhouse plugin runs its viewer (`docket open`, which is also the MCP
server behind `docket_search`) from `wheelhouse/docket/`: docket's CLI built from
the plugin's own commit, committed beside the plugin's server entry and UI
bundle, and run with the node Wheelhouse runs on. Installing or updating the
plugin therefore brings the matching docket, so the viewer, its MCP server and
the plugin can no longer drift apart the way they did when the plugin ran
whatever `docket` was on PATH.

`wheelhouse/build.mjs` builds the copy from `packages/docket/dist` (so it needs
the root `pnpm build` first) and checks it, so every change to docket, its web
UI or its adapters must be followed by `pnpm -C wheelhouse build` and committed.
docket's optional drivers (`neo4j-driver`, `mem0ai`) are not shipped. The
`bin` setting is the escape hatch: an absolute path, or a command name such as
`docket` to use the one on PATH.
