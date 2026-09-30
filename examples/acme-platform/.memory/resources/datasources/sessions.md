---
id: datasource.sessions
type: datasource
title: Support Session Store

attributes:
  zone: private

links:
  - rel: owned_by
    target: team.platform-engineering
---

# Support Session Store

Conversation transcripts from support chat, written by
`service.conversation-api` and read by `agent.research-assistant`.

Transcripts contain personal data, so they stay in `eu-west-1` and are never
copied into staging.
