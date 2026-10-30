---
id: constraint.wheelhouse-plugins-install-without-build
type: constraint
title: Wheelhouse installs and updates plugins without building or installing anything

tags:
  - wheelhouse

links:
  - rel: governs
    target: decision.wheelhouse-plugin-ships-docket-cli
    evidence:
      - source: docs
        path: docs/plugins.md
        repository: https://github.com/chrisjowen/wheelhouse
        commit: be343ba
        urls:
          - https://github.com/chrisjowen/wheelhouse/blob/be343bafc9f7c8af83d98bc4d49ad4d6d92edbc2/docs/plugins.md
        note: Install fetches the repository at a commit, drops the git metadata and never runs the plugin's code; the server entry is imported with no build step and no npm install, so dependencies must be bundled.
        observedAt: 2026-10-31
        observedBy: claude
        session: db7232ae-da49-4682-9743-5f577fc5b78e

evidence:
  - source: code
    path: src/lib/server/plugins/install.ts
    lines: 135
    repository: https://github.com/chrisjowen/wheelhouse
    commit: be343ba
    note: The installer removes .git from the fetched checkout and keeps the rest of the repository as the plugin directory.
    observedAt: 2026-10-31
    observedBy: claude
    session: db7232ae-da49-4682-9743-5f577fc5b78e

provenance:
  capturedBy: claude
---

# Wheelhouse plugins install without a build

Wheelhouse (`wheelhouse plugin install|update`, or Settings → Plugins) fetches
a plugin's repository at a commit and keeps it as it is: no build, no
`npm install`, and none of the plugin's code runs until Wheelhouse restarts and
imports the server entry. A companion service may declare setup steps that run
on Launch, but anything a plugin runs is otherwise whatever its repository
commits. That is why docket's plugin commits its server entry, its UI bundle
and the docket CLI it runs.
