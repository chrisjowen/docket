---
id: service.conversation-api
type: service
title: Conversation API

attributes:
  language: typescript
  lifecycle: active

links:
  - rel: owned_by
    target: team.platform-engineering

  - rel: depends_on
    target: datasource.sessions
    attributes:
      criticality: high
      runtime: true

  - rel: deployed_to
    target: environment.production
---

# Conversation API

Handles conversation persistence and retrieval for support chat. Stores
transcripts in `datasource.sessions` and exposes them to the Research
Assistant read-only.

Transcripts are personal data, so `constraint.eu-data-residency` applies to
this service directly.
