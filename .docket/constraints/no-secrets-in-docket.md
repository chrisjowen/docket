---
id: constraint.no-secrets-in-docket
type: constraint
title: "Never capture credentials or secrets in the docket"

links:
  - rel: governs
    target: repository.docket
    evidence:
      - source: docs
        path: docs/SPEC.md
        lines: 2344-2360
        note: "74 Security: canonical memory is repository content; never capture credentials, secrets, tokens, private keys or passwords."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8
  - rel: governs
    target: agent.docket-claude-plugin
    evidence:
      - source: docs
        path: packages/claude-plugin/skills/remember/SKILL.md
        lines: 199-203
        note: "The remember skill must refuse to capture secrets and record only that a secret exists and where it is managed."
        observedAt: 2026-10-11
        observedBy: claude
        commit: 9fe78c8

evidence:
  - source: docs
    path: docs/SPEC.md
    lines: 2344-2360
    note: "Claude skill instructions must explicitly state this."
    observedAt: 2026-10-11
    observedBy: claude
    commit: 9fe78c8

provenance:
  capturedBy: claude
---

# Never capture credentials or secrets in the docket

Exhibits are committed to the repository and may be sent to remote
projections (hosted mem0, a Neo4j server), so no credential, token, key or
password may be written to `.docket/` - by a person, an agent or a background
review. A `secret` exhibit records a secret's name and where it is managed,
never its value. Configuration follows the same rule: `.docket.yaml` names
environment variables (`passwordEnv`, `apiKeyEnv`) instead of holding keys.
