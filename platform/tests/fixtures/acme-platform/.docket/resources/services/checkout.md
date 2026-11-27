---
id: service.checkout
type: service
title: Checkout

attributes:
  language: typescript
  lifecycle: active

links:
  - rel: owned_by
    target: team.platform-engineering

  - rel: depends_on
    target: service.orders
    attributes:
      criticality: high
      runtime: true

  - rel: uses
    target: library.order-events

  - rel: guarded_by
    target: feature_flag.checkout-rewrite

  - rel: deployed_to
    target: environment.production
---

# Checkout

The browser-facing checkout flow. Collects the cart and payment intent and
hands a submission to Orders; it holds no order state of its own.

The rewritten flow ships behind `feature_flag.checkout-rewrite` so the old and
new implementations can run side by side in production.
