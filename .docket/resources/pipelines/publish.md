---
id: pipeline.publish
type: pipeline
title: Publish workflow (npm trusted publishing)

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
        lines: 1-67
        observedAt: 2026-11-20
        observedBy: claude
  - rel: depends_on
    target: system.npm-registry
    evidence:
      - source: infrastructure
        path: .github/workflows/publish.yml
        lines: 62-67
        symbol: Publish
        note: npm publish --provenance --access public, authenticated by npm trusted publishing (GitHub OIDC), with the NPM_TOKEN repository secret as fallback.
        observedAt: 2026-11-20
        observedBy: claude

evidence:
  - source: infrastructure
    path: .github/workflows/publish.yml
    lines: 1-67
    observedAt: 2026-11-20
    observedBy: claude

provenance:
  capturedBy: claude
---

# Publish workflow

Publishes `@chrisjowen/docket` to npm when a `v<version>` tag is pushed. It
fails unless the tag equals `v` + the version in
`packages/docket/package.json`, then typechecks, builds and tests before
publishing. It authenticates with npm trusted publishing: the workflow's OIDC
token both publishes and signs provenance, with no token or 2FA approval. The
`NPM_TOKEN` repository secret (recorded by name only) is the fallback when
trusted publishing is not configured.
