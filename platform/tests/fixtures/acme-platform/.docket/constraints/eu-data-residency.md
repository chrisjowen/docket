---
id: constraint.eu-data-residency
type: constraint
title: Customer data stays in the EU

links:
  - rel: applies_to
    target: datasource.orders-db

  - rel: applies_to
    target: datasource.sessions

  - rel: applies_to
    target: environment.production
---

# Customer data stays in the EU

Personal data - order lines tied to an identity, and support transcripts -
must be stored and processed in EU regions.

This is imposed by the customer contracts Acme signed, not chosen, so it is a
constraint rather than a decision.

## What it rules out

- US regions for any store holding order or transcript data.
- Copying production data into `environment.staging`, which is why staging
  runs on synthetic orders.
- Any vendor without an EU processing region, which is a standing filter on
  procurement.
