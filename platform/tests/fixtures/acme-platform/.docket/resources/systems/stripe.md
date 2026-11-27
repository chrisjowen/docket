---
id: system.stripe
type: system
title: Stripe
---

# Stripe

The payment processor behind Orders. Acme holds no card data itself; Stripe
Elements keeps the card details out of Acme's systems entirely, which is what
keeps `constraint.pci-scope` satisfiable.
