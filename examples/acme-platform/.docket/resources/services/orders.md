---
id: service.orders
type: service
title: Orders

tags:
  - transactional
  - tier-1

attributes:
  language: typescript
  lifecycle: active

links:
  - rel: owned_by
    target: team.platform-engineering

  - rel: depends_on
    target: datasource.orders-db
    attributes:
      criticality: high
      runtime: true

  - rel: depends_on
    target: system.stripe
    attributes:
      criticality: high
      runtime: true
    evidence:
      - source: manifest
        path: services/orders/package.json
        key: dependencies.stripe
        observedAt: 2026-09-02
        observedBy: claude
      - source: code
        path: services/orders/src/payments/charge.ts
        lines: 8-31
        symbol: chargeOrder
        observedAt: 2026-09-02
        observedBy: claude
        note: Calls stripe.paymentIntents.create before an order is accepted.

  - rel: uses
    target: library.order-events

  - rel: deployed_to
    target: environment.production

provenance:
  authority: repo
  confidence: 1.0
  capturedBy: human
---

# Orders

Owns the order lifecycle from cart submission to fulfilment handoff. It is the
only writer to `datasource.orders-db`; everything else reads order state from
the events it publishes through `library.order-events`.

## Operational notes

Orders is on the payment path, so a failed deploy is a revenue incident rather
than a degraded experience. Rollbacks are expected to complete inside five
minutes.

Stripe is a hard runtime dependency: if it is unavailable Orders rejects new
submissions rather than accepting an order it cannot charge for.
