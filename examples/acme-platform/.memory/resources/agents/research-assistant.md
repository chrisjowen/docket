---
id: agent.research-assistant
type: agent
title: Research Assistant

tags:
  - research
  - agents

attributes:
  package: "@acme/research-assistant"
  runtime: databricks
  modes:
    - fast
    - slow

links:
  - rel: owned_by
    target: team.research-platform

  - rel: depends_on
    target: system.databricks
    attributes:
      criticality: high
      runtime: true

  - rel: uses
    target: datasource.market-data

  - rel: uses
    target: datasource.sessions

  - rel: uses
    target: library.order-events

  - rel: deployed_to
    target: environment.production

provenance:
  authority: repo
  confidence: 0.9
  capturedBy: claude
---

# Research Assistant

Answers merchant questions by combining order history with external market
data. Fast mode answers from cached aggregates; slow mode runs the full
research process over the market-data tables.

## Runtime

The agent runs on Databricks rather than the platform Kubernetes cluster - see
`decision.research-assistant-on-databricks`. The market-data tables it needs
are already there, so moving the compute to the data avoids copying restricted
data out of the lakehouse.

It reads `datasource.sessions` read-only and never writes to it.
