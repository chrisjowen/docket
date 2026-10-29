---
id: decision.docket-open-allow-origin
type: decision
title: docket open lets named pages on this machine use its API with --allow-origin

tags:
  - docket-open
  - security
  - wheelhouse

links:
  - rel: uses
    target: decision.docket-open-127-0-0-1-default
    evidence:
      - source: code
        path: packages/docket/src/open/server.ts
        lines: 99-115
        symbol: allowedOrigin
        note: Allowed origins must be http(s) on 127.0.0.1, localhost or [::1], keeping the API to this machine as the loopback default does.
        observedAt: 2026-10-29
        observedBy: claude
        session: d4ae1baf-edac-4b06-879f-17233cf56f20

evidence:
  - source: code
    path: packages/docket/src/open/server.ts
    lines: 436-460
    symbol: crossOrigin
    note: CORS headers only for allowlisted origins; their preflight is answered, any other page's preflight gets 403. localOnly and pageChange accept an allowlisted Origin, so such a page may read /api/session and sync with the token.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20
  - source: code
    path: packages/docket/src/cli.ts
    lines: 379
    symbol: open --allow-origin
    note: Repeatable CLI option; each value is checked by allowedOrigin before the server starts.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20
  - source: docs
    path: README.md
    lines: 391
    note: README documents --allow-origin, GET /api/health and the Wheelhouse plugin that relies on it.
    observedAt: 2026-10-29
    observedBy: claude
    session: d4ae1baf-edac-4b06-879f-17233cf56f20

provenance:
  capturedBy: claude
---

# docket open --allow-origin

`docket open --allow-origin <origin>` (repeatable) names other pages on this
machine that are as good as docket open's own page: they get CORS headers on
every API answer (errors included), their preflights are answered, and they
may fetch the session token and start a sync with it. Every other page gets no
CORS headers and has its preflight refused. Only http(s) origins on
127.0.0.1, localhost or [::1] are accepted, so the API still never serves a
page elsewhere; the Host header and remote-address checks are unchanged.

`GET /api/health` answers `{ service: "docket-open", root, allowOrigins }`, so
a client (Wheelhouse's service health check) can tell docket open from another
server on the port and confirm which repository it serves.

It exists so Wheelhouse can draw the casebook inside its own page (see
[[decision.wheelhouse-plugin-reuses-docket-ui]]).
