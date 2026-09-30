---
id: constraint.pci-scope
type: constraint
title: Card data never touches Acme systems

links:
  - rel: applies_to
    target: service.checkout

  - rel: applies_to
    target: service.orders

  - rel: applies_to
    target: system.stripe
---

# Card data never touches Acme systems

No Acme service may receive, log or store a full card number. Checkout
collects card details through Stripe Elements, so the card data goes from the
browser to Stripe directly.

This keeps Acme in PCI SAQ-A scope. Any change that routes card details
through an Acme service - a server-rendered payment form, a proxy, a debug log
of a payment payload - breaks the constraint and moves the whole estate into a
far heavier audit.
