// SPDX-License-Identifier: AGPL-3.0-only
import { PLATFORM_SCOPE, verifyAllChains } from '@docket/platform-audit'
import { pruneBuckets } from '@docket/platform-limits'
import type { TenantRouter } from '@docket/platform-tenancy'
import type pg from 'pg'

/** How often each replica looks for due work. */
const TICK_MS = 15 * 60 * 1000
/** The audit chains are verified once a day (§10). */
const CHAIN_CHECK_EVERY_MS = 24 * 60 * 60 * 1000
/** One replica at a time runs the chain check. */
const CHAIN_CHECK_LOCK = "hashtext('docket-cloud:audit-chain-check')"

/** Whether the platform log's last verification is older than a day (or missing). */
async function chainCheckDue(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query<{ due: boolean }>(
    `SELECT coalesce(max(verified_at) < now() - make_interval(secs => $2), true) AS due
       FROM platform.audit_verifications WHERE scope = $1`,
    [PLATFORM_SCOPE, CHAIN_CHECK_EVERY_MS / 1000],
  )
  return rows[0]?.due ?? true
}

/** Verifies every audit chain if a day has passed, holding a lock so replicas take turns. */
export async function runChainCheckIfDue(pool: pg.Pool, router: TenantRouter): Promise<boolean> {
  if (!(await chainCheckDue(pool))) return false
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${CHAIN_CHECK_LOCK}) AS locked`)
    if (!rows[0]?.locked) return false
    try {
      // Another replica may have finished it while this one waited for a connection.
      if (!(await chainCheckDue(pool))) return false
      const verdicts = await verifyAllChains(router)
      const broken = verdicts.filter((verdict) => !verdict.ok)
      if (broken.length) {
        console.error(`audit: chain check FAILED for ${broken.map((verdict) => `${verdict.scope} (at ${verdict.brokenAt ?? verdict.error})`).join(', ')}`)
      } else {
        console.log(`audit: chain check passed for ${verdicts.length} log(s)`)
      }
      return true
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${CHAIN_CHECK_LOCK})`)
    }
  } finally {
    client.release()
  }
}

/**
 * The API's housekeeping, until the worker takes it over: the nightly audit
 * chain check (§10) and pruning idle rate-limit buckets. Runs shortly after
 * start and then every 15 minutes; errors are logged, never thrown.
 */
export function startJobs(pool: pg.Pool, router: TenantRouter): () => void {
  const tick = async () => {
    try {
      await runChainCheckIfDue(pool, router)
    } catch (error) {
      console.error(`jobs: chain check: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      await pruneBuckets(pool)
    } catch (error) {
      console.error(`jobs: prune rate buckets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const first = setTimeout(() => void tick(), 30_000)
  const every = setInterval(() => void tick(), TICK_MS)
  first.unref()
  every.unref()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
