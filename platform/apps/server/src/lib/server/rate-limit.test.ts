// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { rateLimiter } from './rate-limit'

describe('rateLimiter', () => {
  it('allows the limit per window per key, then says when to come back', () => {
    let now = 0
    const limiter = rateLimiter({ limit: 3, windowMs: 60_000, now: () => now })
    expect([1, 2, 3].map(() => limiter.take('tok_a').ok)).toEqual([true, true, true])
    expect(limiter.take('tok_a')).toEqual({ ok: false, retryAfterSeconds: 60 })
    expect(limiter.take('tok_b').ok).toBe(true)
    now = 45_000
    expect(limiter.take('tok_a')).toEqual({ ok: false, retryAfterSeconds: 15 })
    now = 60_000
    expect(limiter.take('tok_a').ok).toBe(true)
  })

  it('checks a key without counting it', () => {
    let now = 0
    const limiter = rateLimiter({ limit: 2, windowMs: 60_000, now: () => now })
    expect(limiter.check('ip').ok).toBe(true)
    limiter.take('ip')
    expect(limiter.check('ip').ok).toBe(true)
    expect(limiter.check('ip').ok).toBe(true)
    limiter.take('ip')
    expect(limiter.check('ip')).toEqual({ ok: false, retryAfterSeconds: 60 })
    now = 60_000
    expect(limiter.check('ip').ok).toBe(true)
  })
})
