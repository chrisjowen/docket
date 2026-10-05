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

  - rel: applies_to
    target: system.databricks

provenance:
  authority: repo
  confidence: 1.0
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
