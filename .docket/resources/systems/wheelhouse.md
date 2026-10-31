---
id: system.wheelhouse
type: system
title: Wheelhouse
category: other
vendor: Chris Owen

tags:
  - plugin-platform
  - project-browsing

evidence:
  - source: conversation
    note: Wheelhouse is an open-source IDE-like project browser Chris Owen is building that supports plugins; docket provides a project tab that shows the casebook and a companion service that runs docket open.
    observedAt: 2026-10-31
    observedBy: claude
    session: db7232ae-da49-4682-9743-5f577fc5b78e

provenance:
  capturedBy: claude
---

# Wheelhouse

Wheelhouse is an open-source project browser platform that docket integrates with as a plugin. The docket plugin ships as a project tab (the casebook) and a companion service (docket open, which is also the MCP server for `docket_search`). Because Wheelhouse installs plugins without a build step or npm install, docket's plugin must commit its server entry (bundled with all dependencies), the UI element (pre-built), and the docket CLI it runs.
