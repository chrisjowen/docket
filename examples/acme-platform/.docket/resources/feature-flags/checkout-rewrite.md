---
id: feature_flag.checkout-rewrite
type: feature_flag
title: Checkout rewrite

attributes:
  key: checkout.rewrite
  rollout: percentage
  temporary: true
---

# Checkout rewrite

Routes a percentage of sessions to the rewritten checkout flow. Currently at
10% of traffic in production.

Temporary: the flag is removed once the old flow is deleted. It exists in
memory because "is the rewrite on?" is a question every incident review asks,
and the answer is not in the code.
