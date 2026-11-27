---
id: decision.research-assistant-on-databricks
type: decision
title: Host the Research Assistant on Databricks

tags:
  - runtime
  - agents

links:
  - rel: applies_to
    target: agent.research-assistant
    evidence:
      - source: conversation
        observedAt: 2026-09-14
        observedBy: claude
        session: 7f3c9a1e

  - rel: applies_to
    target: system.databricks
    evidence:
      - source: conversation
        observedAt: 2026-09-14
        observedBy: claude
        session: 7f3c9a1e

evidence:
  - source: conversation
    observedAt: 2026-09-14
    observedBy: claude
    session: 7f3c9a1e
    note: Agreed with the user after weighing the market-data licence against copying tables out of the lakehouse.

provenance:
  capturedBy: claude
---

# Host the Research Assistant on Databricks

Databricks will host the Research Assistant.

## Context

Slow mode scans the full market-data tables. Running the agent on the platform
Kubernetes cluster meant pulling those tables across a network boundary on
every run, and the market-data licence does not permit holding extracts
outside the lakehouse.

## Decision

Run the agent's compute inside the existing Databricks workspace. The platform
cluster keeps the transactional services only.

## Consequences

Research Platform operates the agent, not Platform Engineering; the two run on
different infrastructure and have separate on-call rotations. The agent reads
`datasource.sessions` over the network, which is acceptable because the volume
is small and both estates are in the EU.
