---
id: datasource.orders-db
type: datasource
title: Orders Postgres

attributes:
  zone: restricted

links:
  - rel: owned_by
    target: team.platform-engineering
---

# Orders Postgres

The single writable store for order state, in `eu-west-1`. Only
`service.orders` connects to it; other services read order state from the
event stream instead.

Restricted zone: it holds order lines tied to a customer identity.
