// SPDX-License-Identifier: AGPL-3.0-only
import type pg from 'pg'

/** A bucket holds up to `capacity` tokens and refills continuously at `perSecond`. */
export interface BucketRule {
  capacity: number
  perSecond: number
}

/** `n` calls a minute, with a burst of up to `n` (§12). */
export function perMinute(n: number): BucketRule {
  if (!(n > 0)) throw new RangeError('a limit allows at least one call')
  return { capacity: n, perSecond: n / 60 }
}

export interface BucketState {
  tokens: number
  /** Milliseconds since the epoch. */
  updatedAt: number
}

export interface TakeResult {
  allowed: boolean
  /** Tokens left after this call (allowed) or now (refused). */
  remaining: number
  /** How long until `cost` tokens are back; 0 when allowed. */
  retryAfterMs: number
}

/**
 * The bucket arithmetic. A missing state is a full bucket. Refused calls take
 * nothing, so a client that keeps calling while it is limited does not push
 * its own retry further out.
 */
export function refill(state: BucketState | undefined, rule: BucketRule, now: number): number {
  if (!state) return rule.capacity
  const elapsed = Math.max(0, now - state.updatedAt) / 1000
  return Math.min(rule.capacity, state.tokens + elapsed * rule.perSecond)
}

export function retryAfterMs(tokens: number, rule: BucketRule, cost: number): number {
  return tokens >= cost ? 0 : Math.ceil(((cost - tokens) / rule.perSecond) * 1000)
}

/** One bucket to take from: a key such as `mcp:token:<id>` and its rule. */
export interface BucketRequest {
  key: string
  rule: BucketRule
}

/**
 * Where bucket state lives. `take` is all or nothing: it takes `cost` from
 * every bucket, or, when any of them is short, from none, so a call refused by
 * the org's bucket does not spend the token's.
 */
export interface BucketStore {
  take(requests: readonly BucketRequest[], cost: number): Promise<TakeResult[]>
}

/**
 * Bucket state in this process only, for tests and a single local process.
 */
export function memoryBucketStore(options: { now?: () => number } = {}): BucketStore {
  const now = options.now ?? Date.now
  const buckets = new Map<string, BucketState>()
  return {
    async take(requests, cost) {
      const at = now()
      const levels = requests.map((request) => refill(buckets.get(request.key), request.rule, at))
      const allowed = levels.every((tokens) => tokens >= cost)
      return requests.map((request, i) => {
        const tokens = levels[i] ?? 0
        if (!allowed) return { allowed: false, remaining: tokens, retryAfterMs: retryAfterMs(tokens, request.rule, cost) }
        buckets.set(request.key, { tokens: tokens - cost, updatedAt: at })
        return { allowed: true, remaining: tokens - cost, retryAfterMs: 0 }
      })
    },
  }
}

type BucketRow = { key: string; tokens: number; updated_ms: number; now_ms: number }

/**
 * Bucket state in `platform.rate_buckets`, shared by every API replica (§12).
 * One transaction locks the rows in key order, so concurrent calls on the same
 * buckets serialise instead of deadlocking, and time is the database's clock,
 * so replicas with drifting clocks agree.
 */
export function postgresBucketStore(pool: pg.Pool): BucketStore {
  return {
    async take(requests, cost) {
      const keys = [...new Set(requests.map((request) => request.key))].sort()
      const capacities = keys.map((key) => requests.find((request) => request.key === key)?.rule.capacity ?? 0)
      const client = await pool.connect()
      let broken = false
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO platform.rate_buckets (key, tokens, updated_at)
           SELECT key, capacity, clock_timestamp() FROM unnest($1::text[], $2::float8[]) AS r(key, capacity)
            ORDER BY key
           ON CONFLICT (key) DO NOTHING`,
          [keys, capacities],
        )
        const { rows } = await client.query<BucketRow>(
          `SELECT key, tokens, extract(epoch FROM updated_at) * 1000 AS updated_ms,
                  extract(epoch FROM clock_timestamp()) * 1000 AS now_ms
             FROM platform.rate_buckets WHERE key = ANY($1::text[]) ORDER BY key FOR UPDATE`,
          [keys],
        )
        const byKey = new Map(rows.map((row) => [row.key, row]))
        const at = Number(rows[0]?.now_ms ?? Date.now())
        const levels = requests.map((request) => {
          const row = byKey.get(request.key)
          return refill(row && { tokens: Number(row.tokens), updatedAt: Number(row.updated_ms) }, request.rule, at)
        })
        const allowed = levels.every((tokens) => tokens >= cost)
        if (allowed) {
          const left = new Map(requests.map((request, i) => [request.key, (levels[i] ?? 0) - cost]))
          await client.query(
            `UPDATE platform.rate_buckets b SET tokens = r.tokens, updated_at = to_timestamp($3::float8 / 1000)
               FROM unnest($1::text[], $2::float8[]) AS r(key, tokens) WHERE b.key = r.key`,
            [[...left.keys()], [...left.values()].map((tokens) => Math.max(0, tokens)), at],
          )
        }
        await client.query('COMMIT')
        return requests.map((request, i) => {
          const tokens = levels[i] ?? 0
          return allowed
            ? { allowed: true, remaining: tokens - cost, retryAfterMs: 0 }
            : { allowed: false, remaining: tokens, retryAfterMs: retryAfterMs(tokens, request.rule, cost) }
        })
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          broken = true
        }
        throw error
      } finally {
        client.release(broken)
      }
    },
  }
}

/** Removes buckets idle for longer than `idleMs` (they are full again, so nothing is lost). */
export async function pruneBuckets(pool: pg.Pool, idleMs = 60 * 60 * 1000): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM platform.rate_buckets WHERE updated_at < clock_timestamp() - make_interval(secs => $1)',
    [idleMs / 1000],
  )
  return rowCount ?? 0
}
