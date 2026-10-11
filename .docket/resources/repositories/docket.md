---
id: repository.docket
type: repository
title: docket monorepo

attributes:
  defaultBranch: main
  url: https://github.com/chrisjowen/docket

links:
  - rel: contains
    target: library.docket-cli
    evidence:
      - source: manifest
        path: pnpm-workspace.yaml
        lines: 1-2
        note: Every directory under packages/ is a pnpm workspace package.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.docket-contracts
    evidence:
      - source: manifest
        path: packages/contracts/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.docket-adapter-kit
    evidence:
      - source: manifest
        path: packages/adapter-kit/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.docket-ui
    evidence:
      - source: manifest
        path: packages/docket-ui/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.adapter-jsonl
    evidence:
      - source: manifest
        path: packages/adapter-jsonl/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.adapter-neo4j
    evidence:
      - source: manifest
        path: packages/adapter-neo4j/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.adapter-mem0
    evidence:
      - source: manifest
        path: packages/adapter-mem0/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.adapter-memvid
    evidence:
      - source: manifest
        path: packages/adapter-memvid/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: library.adapter-mempalace
    evidence:
      - source: manifest
        path: packages/adapter-mempalace/package.json
        lines: 2
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: agent.docket-claude-plugin
    evidence:
      - source: manifest
        path: .claude-plugin/marketplace.json
        lines: 10-17
        note: The marketplace entry points its plugin source at ./packages/claude-plugin.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: pipeline.ci
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 1-21
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: pipeline.publish
    evidence:
      - source: infrastructure
        path: .github/workflows/publish.yml
        lines: 1-57
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: document.docket-spec
    evidence:
      - source: docs
        path: docs/SPEC.md
        lines: 1-5
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: contains
    target: document.adapter-spec
    evidence:
      - source: docs
        path: docs/adapter-spec.md
        lines: 1-12
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: manifest
    path: packages/docket/package.json
    lines: 13-21
    key: repository
    note: The published package names github.com/chrisjowen/docket as its repository, directory packages/docket.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 3-6
    note: CI runs on pushes to main and on pull requests, so main is the default branch.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# docket monorepo

The source of docket: a pnpm workspace (`pnpm-workspace.yaml`, pnpm 10 per the
root `package.json`) whose packages are the published CLI
`@chrisjowen/docket`, its private contracts and adapter kit, the bundled web
UI, five storage adapters, and the Claude Code plugin served from the
repository's own plugin marketplace (`.claude-plugin/marketplace.json`).

The design is written down in `docs/SPEC.md` (the core system) and
`docs/adapter-spec.md` (pluggable adapters); `PLAN.md` records the build
phases and decisions taken during the build, and `docs/ACCEPTANCE.md` the
acceptance run.

The git remote in this checkout is `github.com/chrisjowen/team-memory` while
the package manifest says `github.com/chrisjowen/docket`; the repository
appears to have been renamed, and the `url` attribute follows the manifest.
