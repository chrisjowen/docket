---
id: pipeline.publish
type: pipeline
title: Publish workflow (npm staged publish)

attributes:
  provider: github-actions
  path: .github/workflows/publish.yml
  triggers:
    - push of a v* tag

links:
  - rel: defined_in
    target: repository.docket
    evidence:
      - source: infrastructure
        path: .github/workflows/publish.yml
        lines: 1-57
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: depends_on
    target: system.npm-registry
    evidence:
      - source: infrastructure
        path: .github/workflows/publish.yml
        lines: 53-57
        symbol: Stage
        note: npm stage publish --provenance --access public, authenticated by the NPM_TOKEN repository secret.
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: infrastructure
    path: .github/workflows/publish.yml
    lines: 1-57
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Publish workflow

Stages `@chrisjowen/docket` on npm when a `v<version>` tag is pushed. It
fails unless the tag equals `v` + the version in
`packages/docket/package.json`, then typechecks, builds and tests before
staging. npm refuses CI publishes without 2FA, so the version lands in npm's
staging area and a maintainer approves it with 2FA (`npm stage approve`).
Provenance is signed with the workflow's OIDC token; publishing rights come
from the `NPM_TOKEN` repository secret (recorded by name only).
