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
    evidence:
      - source: conversation
        observedAt: 2026-09-14
        observedBy: claude
        session: 7f3c9a1e
        note: The user said Research Platform runs the agent and its on-call.

  - rel: depends_on
    target: system.databricks
    attributes:
      criticality: high
      runtime: true
    evidence:
      - source: infrastructure
        path: agents/research-assistant/databricks.yml
        lines: 1-38
        symbol: resources.jobs.research-assistant
        observedAt: 2026-09-14
        observedBy: claude
        note: The Databricks asset bundle that deploys the agent as a job.

  - rel: uses
    target: datasource.market-data
    evidence:
      - source: code
        path: agents/research-assistant/src/sources/market.ts
        lines: 5-27
        symbol: marketDataTables
        observedAt: 2026-09-14
        observedBy: claude

  - rel: uses
    target: datasource.sessions
    evidence:
      - source: code
        path: agents/research-assistant/src/sources/sessions.ts
        lines: 9
        symbol: readSession
        observedAt: 2026-09-14
        observedBy: claude
        note: Read-only client; nothing in the agent writes sessions.

  - rel: uses
    target: library.order-events
    evidence:
      - source: manifest
        path: agents/research-assistant/package.json
        key: dependencies.@acme/order-events
        observedAt: 2026-09-14
        observedBy: claude

  - rel: deployed_to
    target: environment.production
    evidence:
      - source: infrastructure
        path: agents/research-assistant/databricks.yml
        lines: 40-52
        symbol: targets.production
        observedAt: 2026-09-14
        observedBy: claude

evidence:
  - source: code
    path: agents/research-assistant/src/agent.ts
    lines: 12-64
    symbol: ResearchAssistant
    observedAt: 2026-09-14
    observedBy: claude
    note: Defines the agent and its fast and slow modes.

  - source: manifest
    path: agents/research-assistant/package.json
    key: name
    observedAt: 2026-09-14
    observedBy: claude
    note: Published as @acme/research-assistant.

  - source: conversation
    observedAt: 2026-09-14
    observedBy: claude
    session: 7f3c9a1e
    note: The user confirmed Research Platform owns and operates the agent.

provenance:
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

## How it was found

The agent class and its two modes are in `agents/research-assistant/src/agent.ts`;
the Databricks job that runs it is the asset bundle in
`agents/research-assistant/databricks.yml`. Ownership came from the session
that moved it to Databricks, not from the code.
