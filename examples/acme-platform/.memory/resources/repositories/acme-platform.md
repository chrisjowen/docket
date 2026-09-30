---
id: repository.acme-platform
type: repository
title: acme-platform

attributes:
  url: https://github.com/acme/acme-platform
  defaultBranch: main

links:
  - rel: owned_by
    target: team.platform-engineering
---

# acme-platform

The monorepo holding Orders, Checkout and the Conversation API, plus the
shared `@acme/order-events` package.

The Research Assistant lives in its own repository because it is deployed by
a different team on different infrastructure.
