---
id: decision.docket-open-serves-docket-search-mcp-app
type: decision
title: docket open serves docket's MCP server at /mcp, with docket_search and its MCP app

tags:
  - docket-open
  - mcp
  - wheelhouse

links:
  - rel: uses
    target: decision.docket-open-127-0-0-1-default
    evidence:
      - source: code
        path: packages/docket/src/open/server.ts
        lines: 473-520
        symbol: mcp
        note: "POST /mcp is checked by localOnly, as a sync is, and must be application/json, so only programs on this machine reach it: it answers no CORS preflight, so no browser page can, even one --allow-origin named."
        observedAt: 2026-10-30
        observedBy: claude
        session: c478579d-7213-4499-b781-c69121601e8b

  - rel: uses
    target: library.docket-ui
    evidence:
      - source: code
        path: packages/docket-ui/src/mcp-app/app.svelte
        symbol: GraphView
        note: The search app is the casebook's graph view and type marks, built to one inlined page by vite.mcp-app.config.ts.
        observedAt: 2026-10-30
        observedBy: claude
        session: c478579d-7213-4499-b781-c69121601e8b

  - rel: uses
    target: decision.wheelhouse-plugin-reuses-docket-ui
    evidence:
      - source: code
        path: wheelhouse/src/server.ts
        lines: 265
        symbol: mcpServers
        note: The Wheelhouse plugin declares the viewer's /mcp as its MCP server "docket" on the viewer service, so Wheelhouse can call docket_search per project and draw its app.
        observedAt: 2026-10-30
        observedBy: claude
        session: c478579d-7213-4499-b781-c69121601e8b

evidence:
  - source: code
    path: packages/docket/src/mcp/server.ts
    lines: 28-52
    symbol: searchTool
    note: One read-only tool, docket_search { query, limit? }, with _meta.ui.resourceUri ui://docket/search.html; the server keeps no session and speaks MCP 2025-11-25, 2025-06-18 and 2025-03-26.
    observedAt: 2026-10-30
    observedBy: claude
    session: c478579d-7213-4499-b781-c69121601e8b
  - source: code
    path: packages/claude-plugin/scripts/session-start.js
    lines: 47-62
    symbol: PROJECTS_CONTEXT
    note: Outside a docket repository the SessionStart hook says to search the docket of a project the session is asked about, preferring a connected docket MCP server's docket_search, which draws the matches as a graph in the chat, and falling back to docket search in its clone when none is connected.
    observedAt: 2026-10-30
    observedBy: claude
    session: c478579d-7213-4499-b781-c69121601e8b
  - source: docs
    path: docs/mcp.md
    note: The docket_search contract - transport, tool, docket-search.v1 structured content and the app's bridge.
    observedAt: 2026-10-30
    observedBy: claude
    session: c478579d-7213-4499-b781-c69121601e8b

provenance:
  capturedBy: claude
---

# docket open serves docket's MCP server at /mcp

`docket open` is also an MCP server for the docket it serves: `POST /mcp`,
Streamable HTTP answered as JSON, with no sessions, for this machine only. Its
one tool, `docket_search`, runs `docket search` and returns the matches, the
resources one link away (at most 60 on the board) and the links between them,
as text for the model and as `docket-search.v1` structured content. The tool
carries an MCP app (`io.modelcontextprotocol/ui`, spec 2026-01-26),
`ui://docket/search.html`: one self-contained page built from docket-ui's own
graph view, needing no network, that draws them on the casebook's board.

It lives on the viewer rather than in a process of its own, so Wheelhouse
reaches it through the docket plugin's existing `viewer` companion service
(`mcpServers: [{ id: docket, service: viewer, path: /mcp }]`), started by the
same Launch.

Agents learn to search a project's docket from the docket Claude Code plugin,
not from the Wheelhouse plugin: Wheelhouse plugins have no install hook and
installing one runs no code. The plugin's SessionStart hook, outside any
docket repository (a supervisor's home such as Firstmate's), tells the session
to search the docket of a project it is asked about: with a connected docket
MCP server's `docket_search`, which draws the graph in the chat, or else with
`docket search` in the project's clone. It comes and goes with the
plugin and writes nothing to any project's AGENTS.md or CLAUDE.md.
