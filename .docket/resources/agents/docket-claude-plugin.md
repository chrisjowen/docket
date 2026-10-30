---
id: agent.docket-claude-plugin
type: agent
title: docket Claude Code plugin

attributes:
  runtime: claude-code
  modes:
    - session-start-context
    - background-review
  package: "@chrisjowen/docket-claude-plugin"

links:
  - rel: depends_on
    target: system.claude-code
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/claude-plugin/scripts/review-runner.js
        lines: 139
        symbol: spawn("claude", args)
        note: The background evidence review runs a separate claude process, on haiku unless DOCKET_REVIEW_MODEL names another.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: config
        path: packages/claude-plugin/hooks/hooks.json
        lines: 1-47
        note: SessionStart, Stop, PreCompact and SessionEnd hooks.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: library.docket-cli
    attributes:
      runtime: true
    evidence:
      - source: code
        path: packages/claude-plugin/scripts/cli.js
        lines: 15-24
        symbol: NPX_COMMAND
        note: Runs the project's own docket, else one on PATH, else the release it pins through npx -y @chrisjowen/docket@<version>.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
      - source: code
        path: packages/claude-plugin/bin/docket
        lines: 1-19
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: system.npm-registry
    attributes:
      runtime: true
      criticality: low
    evidence:
      - source: code
        path: packages/claude-plugin/scripts/cli.js
        lines: 15-18
        symbol: NPX_DOCKET
        note: Falls back to fetching the pinned CLI from npm via npx when no local or PATH docket exists.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: .claude-plugin/marketplace.json
    lines: 10-17
    note: Marketplace "docket" lists plugin docket 0.5.0 sourced from ./packages/claude-plugin.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: manifest
    path: packages/claude-plugin/package.json
    lines: 1-8
    note: Private; not published to npm, installed through the plugin marketplace.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# docket Claude Code plugin

A Claude Code plugin, installed from this repository's marketplace
(`/plugin marketplace add chrisjowen/docket`), made of three skills
(`docket`, `remember`, `ontology`), a `bin/docket` wrapper, and hooks:

- **SessionStart** injects docket context and starts one background
  `docket sync` (`scripts/session-start.js`).
- **Stop, PreCompact and SessionEnd** run `scripts/review.js`, which may start
  a detached background review: a separate `claude` process reading the
  session transcript and writing evidence into `.docket/` through the
  `remember` skill. Stop waits for 200 unreviewed transcript lines
  (`DOCKET_REVIEW_STOP_LINES`).

`review.js` exits immediately when `DOCKET_REVIEW` is set (line 73) and sets
it in the review agent's own environment so other tools can recognise it. The
review agent runs with every hook disabled (`--settings
'{"disableAllHooks":true}'` in `scripts/review-runner.js`), so no repository or
plugin SessionStart hook can act on the session it reviews. Firstmate
workers set `DOCKET_REVIEW=1` deliberately to keep automatic reviews off and
capture knowledge in pull requests instead.

The plugin's marketplace version (0.5.0) moves independently of the CLI's
(0.4.0).
