---
id: service.orders
type: service
title: Orders
attributes:
  tier: critical
  language: typescript
links:
  - rel: depends_on
    target: datasource.orders-db
    evidence:
      - source: code
        path: src/db.ts
        lines: 12-30
  - rel: depends_on
    target: service.payments
  - rel: owned_by
    target: team.commerce
  - rel: exposes
    target: api.orders
evidence:
  - source: manifest
    path: package.json
    key: name
---
Takes and tracks customer orders.
