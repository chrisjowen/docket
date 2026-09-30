---
id: decision.orders-on-dynamodb
type: decision
title: Store order state in DynamoDB

links:
  - rel: applies_to
    target: service.orders
---

# Store order state in DynamoDB

Superseded by `decision.orders-on-postgres`. Kept because the reasoning
explains why the event schema in `library.order-events` is shaped the way it
is - it was designed for a store with no cross-row transactions.

## Original decision

Order state in DynamoDB, one item per order, with cross-entity consistency
handled in the application.
