---
id: pipeline.ci
type: pipeline
title: CI workflow

attributes:
  provider: github-actions
  path: .github/workflows/ci.yml
  triggers:
    - push to main
    - pull_request

links:
  - rel: defined_in
    target: repository.docket
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 1-21
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 1-21
    note: One ubuntu job on Node 22 - pnpm install --frozen-lockfile, typecheck, build, test.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# CI workflow

Runs on every push to `main` and every pull request: install with a frozen
pnpm lockfile, `pnpm typecheck`, `pnpm build`, `pnpm test` across the
workspace on Node 22. Build runs before test because the end-to-end tests
exercise the built CLI.
