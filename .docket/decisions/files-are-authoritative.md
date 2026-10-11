---
id: decision.files-are-authoritative
type: decision
title: "Canonical Markdown files are authoritative; projections are disposable"

links:
  - rel: documented_in
    target: document.docket-spec
    evidence:
      - source: docs
        path: docs/SPEC.md
        lines: 34-66
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: docs
    path: docs/SPEC.md
    lines: 34-66
    note: "2.1 Files are authoritative; 2.2 rm -rf .docket/.index && docket rebuild must always be safe."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: docs
    path: PLAN.md
    lines: 9-13
    note: "The invariant: ontology + canonical files -> reconciliation -> projections (disposable)."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8
  - source: config
    path: .gitignore
    lines: 5-7
    note: "**/.docket/.index/ and **/.docket/.cache/ are ignored as derived, never canonical."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Canonical Markdown files are authoritative; projections are disposable

Knowledge lives only in Markdown files under `.docket/`. Every index - the
JSONL files, Neo4j, mem0, memvid, MemPalace - is a projection rebuilt from
those files, and deleting one must always be safe. Indexes and caches are
therefore gitignored, and commands such as `docket graph --json` and
`docket open` read the files rather than any index.

## Consequences

- An exhibit's identity is its frontmatter `id`, never its path.
- `docket rebuild` must reproduce a projection byte-for-byte (rebuild
  determinism tests, SPEC §72).
- Committing `.docket/.index/` is never needed; this repository does not.
