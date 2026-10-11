---
id: system.npm-registry
type: system
title: npm registry

attributes:
  category: other
  vendor: npm

evidence:
  - source: infrastructure
    path: .github/workflows/publish.yml
    lines: 34
    note: The publish workflow targets https://registry.npmjs.org.
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: manifest
    path: packages/docket/package.json
    lines: 41-43
    key: publishConfig
    note: "publishConfig.access is public: the CLI is a public npm package."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# npm registry

Where `@chrisjowen/docket` is published (staged, then approved with 2FA) and where users install it from - `npx @chrisjowen/docket setup`, global installs, and the plugin's pinned `npx -y` fallback.
