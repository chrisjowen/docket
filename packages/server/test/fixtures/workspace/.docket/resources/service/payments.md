---
id: service.payments
type: service
title: Payments
attributes:
  tier: critical
links:
  - rel: depends_on
    target: datasource.ledger-db
  - rel: owned_by
    target: team.commerce
evidence:
  - source: human
    observedBy: alice
---
Charges cards and records every movement in the ledger.
