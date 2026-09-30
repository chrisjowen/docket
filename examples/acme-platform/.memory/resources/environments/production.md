---
id: environment.production
type: environment
title: Production

attributes:
  environmentType: production
---

# Production

Two distinct estates share the name: the platform Kubernetes cluster in
`eu-west-1` where Orders, Checkout and the Conversation API run, and the
Databricks workspace where the Research Assistant runs.

Both are in EU regions because of `constraint.eu-data-residency`.
