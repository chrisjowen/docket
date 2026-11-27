---
id: decision.orders-on-postgres
type: decision
title: Keep order state in Postgres

links:
  - rel: supersedes
    target: decision.orders-on-dynamodb

  - rel: applies_to
    target: service.orders

  - rel: applies_to
    target: datasource.orders-db
---

# Keep order state in Postgres

## Context

The original design put order state in DynamoDB for write throughput. In
practice the order lifecycle needs multi-row transactions - reserve stock,
write the order, record the payment intent - and the application-level
two-phase commit built to work around that was the source of most order
integrity incidents.

## Decision

Order state lives in a single Postgres instance, `datasource.orders-db`, and
`service.orders` is its only writer.

## Consequences

Write throughput is capped by one primary. Measured peak is far below that
ceiling, and the integrity bugs disappeared. Revisit only if peak write rate
approaches the primary's limit.
