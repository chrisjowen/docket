---
id: library.order-events
type: library
title: Order Events

attributes:
  language: typescript
  package: "@acme/order-events"

links:
  - rel: owned_by
    target: team.platform-engineering
---

# Order Events

The shared schema for order lifecycle events. Orders publishes them, Checkout
and the Research Assistant consume them.

It is a library rather than a service: it has no runtime of its own, and
changing it requires a version bump in every consumer.
