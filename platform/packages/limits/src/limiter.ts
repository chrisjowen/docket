// SPDX-License-Identifier: AGPL-3.0-only
import type { BucketRule, BucketStore } from './token-bucket.js'

/** One limit a call is counted against, for example the calling token's MCP limit. */
export interface Limit {
  /** Who the limit is per, for messages and metrics: `token`, `org`, `address`. */
  scope: string
  /** What is counted, for messages: `calls` unless given. */
  what?: string
  /** The bucket key, unique across every limit: `mcp:token:<id>`. */
  key: string
  rule: BucketRule
}

export type Decision =
  | { allowed: true }
  | {
      allowed: false
      /** The limit that refused the call (the first, when several did). */
      limit: Limit
      /** Whole seconds, at least 1: the `Retry-After` value. */
      retryAfterSeconds: number
      /** True when this process refused from memory, without asking the store. */
      cached: boolean
    }

export type Refusal = Extract<Decision, { allowed: false }>

/**
 * A call over a limit (§12). Routes turn it into a 429 with `Retry-After`.
 * The MCP route answers through `mcpRateLimit` instead; this is for other routes.
 */
export class RateLimited extends Error {
  override name = 'RateLimited'
  constructor(readonly refusal: Refusal) {
    super(rateLimitMessage(refusal))
  }
}

/** The calls a minute a rule allows, for messages. */
export function callsPerMinute(rule: BucketRule): number {
  return Math.round(rule.perSecond * 60)
}

/** What a client (or a model reading an MCP tool error) is told. */
export function rateLimitMessage(refusal: Refusal): string {
  const { limit, retryAfterSeconds } = refusal
  const seconds = retryAfterSeconds === 1 ? '1 second' : `${retryAfterSeconds} seconds`
  return `Rate limit reached: at most ${callsPerMinute(limit.rule)} ${limit.what ?? 'calls'} a minute per ${limit.scope}. Try again in ${seconds}.`
}

export interface RateLimiter {
  /** Counts one call (or `cost` calls) against every limit, or refuses it and counts it against none. */
  check(limits: readonly Limit[], cost?: number): Promise<Decision>
  /** `check`, throwing `RateLimited` on a refusal. */
  enforce(limits: readonly Limit[], cost?: number): Promise<void>
}

const MAX_REMEMBERED = 10_000

/**
 * Token buckets in a shared store, cached in process (§12): once the store
 * refuses a key, this process refuses it from memory until its retry time,
 * so a client hammering past its limit costs no database round trips.
 */
export function rateLimiter(options: {
  store: BucketStore
  now?: () => number
  /** Called on every refusal, for metrics. */
  onRefused?: (refusal: Refusal) => void
}): RateLimiter {
  const now = options.now ?? Date.now
  const refusedUntil = new Map<string, number>()

  function remember(key: string, until: number): void {
    if (refusedUntil.size >= MAX_REMEMBERED) {
      const at = now()
      for (const [k, t] of refusedUntil) if (t <= at) refusedUntil.delete(k)
      if (refusedUntil.size >= MAX_REMEMBERED) refusedUntil.clear()
    }
    refusedUntil.set(key, until)
  }

  function refused(refusal: Refusal): Refusal {
    options.onRefused?.(refusal)
    return refusal
  }

  const limiter: RateLimiter = {
    async check(limits, cost = 1) {
      if (limits.length === 0) return { allowed: true }
      const at = now()
      for (const limit of limits) {
        const until = refusedUntil.get(limit.key)
        if (until === undefined) continue
        if (until > at) {
          return refused({ allowed: false, limit, retryAfterSeconds: Math.max(1, Math.ceil((until - at) / 1000)), cached: true })
        }
        refusedUntil.delete(limit.key)
      }
      const results = await options.store.take(
        limits.map((limit) => ({ key: limit.key, rule: limit.rule })),
        cost,
      )
      if (results.every((result) => result.allowed)) return { allowed: true }
      // Remember every short bucket, and report the one that clears last.
      let worst: { limit: Limit; ms: number } | undefined
      results.forEach((result, i) => {
        const limit = limits[i]
        if (!limit || result.retryAfterMs <= 0) return
        remember(limit.key, at + result.retryAfterMs)
        if (!worst || result.retryAfterMs > worst.ms) worst = { limit, ms: result.retryAfterMs }
      })
      const blocking = worst ?? { limit: limits[0] as Limit, ms: 1000 }
      return refused({
        allowed: false,
        limit: blocking.limit,
        retryAfterSeconds: Math.max(1, Math.ceil(blocking.ms / 1000)),
        cached: false,
      })
    },
    async enforce(limits, cost) {
      const decision = await limiter.check(limits, cost)
      if (!decision.allowed) throw new RateLimited(decision)
    },
  }
  return limiter
}

/**
 * A plain 429 for an HTTP route: `Retry-After` and a JSON body with the message.
 * The MCP route answers `mcpRateLimitedResponse` instead.
 */
export function rateLimitedResponse(refusal: Refusal): Response {
  return Response.json(
    {
      error: 'rate_limited',
      message: rateLimitMessage(refusal),
      scope: refusal.limit.scope,
      limitPerMinute: callsPerMinute(refusal.limit.rule),
      retryAfterSeconds: refusal.retryAfterSeconds,
    },
    { status: 429, headers: { 'retry-after': String(refusal.retryAfterSeconds), 'cache-control': 'no-store' } },
  )
}
