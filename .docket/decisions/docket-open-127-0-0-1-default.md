---
id: decision.docket-open-127-0-0-1-default
type: decision
title: docket open listens on 127.0.0.1 by default, with --host option for other addresses

tags:
  - docket-open
  - security
  - breaking-change

evidence:
  - source: code
    path: packages/docket/src/open/server.ts
    lines: 70
    symbol: server listen address
    note: The server listens on 127.0.0.1 by default, controlled by a --host CLI flag.
    observedAt: 2026-10-26
    observedBy: claude
    session: 545488c7-b406-402b-8f89-e4d88e865c28
    commit: b74099f
  - source: code
    path: packages/docket/src/commands/open.ts
    note: The open command registers the --host option.
    observedAt: 2026-10-26
    observedBy: claude
    session: 545488c7-b406-402b-8f89-e4d88e865c28
    commit: b74099f
  - source: docs
    path: README.md
    note: Documents the 127.0.0.1 default as a breaking change from earlier versions which listened on 0.0.0.0. Explains how to opt back in with --host 0.0.0.0 for LAN access.
    observedAt: 2026-10-26
    observedBy: claude
    session: 545488c7-b406-402b-8f89-e4d88e865c28
    commit: b74099f
  - source: conversation
    note: During no-mistakes review (session 545488c7-b406-402b-8f89-e4d88e865c28), the user chose to keep the host-default-scope finding ignored (accepted the breaking change). The decision was deliberately reviewed and kept.
    observedAt: 2026-10-26
    observedBy: claude
    session: 545488c7-b406-402b-8f89-e4d88e865c28

provenance:
  capturedBy: claude
---

# docket open listens on 127.0.0.1 by default

Breaking change: `docket open` now listens on `127.0.0.1` by default instead of `0.0.0.0`. Earlier versions were reachable from any machine on the LAN. With this change, the UI is only accessible from the local machine.

A `--host` CLI option allows users to customize the listen address, so LAN access can be restored with `docket open --host 0.0.0.0`.

The narrower default is a deliberate choice for security, not a requirement to protect sync. The sync API already guards itself through `localOnly` address checks, Host/Origin/Sec-Fetch-Site headers, and per-launch session tokens — these work regardless of which interface the server listens on. The change to 127.0.0.1 is a defense-in-depth measure to reduce the attack surface.

