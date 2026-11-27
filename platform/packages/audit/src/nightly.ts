// SPDX-License-Identifier: AGPL-3.0-only
import type pg from 'pg'

import { verifyChainIn } from './audit.js'
import type { ChainVerdict } from './chain.js'

interface Router {
  withPlatform<T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T>
  withTenant<T>(orgId: string, fn: (tx: pg.ClientBase) => Promise<T>): Promise<T>
}

/** The platform's own log, in `platform.audit_verifications`. Org logs use the org id. */
export const PLATFORM_SCOPE = 'platform'

export interface ScopeVerdict extends ChainVerdict {
  scope: string
  /** Set when the log could not be read at all; the verdict then counts as failed. */
  error?: string
}

/**
 * The nightly check (§10): verifies the platform log and every active org's
 * log, and records each verdict in `platform.audit_verifications`, where the
 * metrics endpoint reads it for the alert. One org's failure does not stop
 * the others being checked.
 */
export async function verifyAllChains(router: Router): Promise<ScopeVerdict[]> {
  const orgs = await router.withPlatform(async (tx) => {
    const { rows } = await tx.query<{ id: string }>("SELECT id FROM orgs WHERE status = 'active' ORDER BY id")
    return rows.map((row) => row.id)
  })
  const verdicts: ScopeVerdict[] = []
  for (const scope of [PLATFORM_SCOPE, ...orgs]) {
    try {
      const verdict = scope === PLATFORM_SCOPE ? await router.withPlatform(verifyChainIn) : await router.withTenant(scope, verifyChainIn)
      verdicts.push({ scope, ...verdict })
    } catch (error) {
      verdicts.push({ scope, ok: false, events: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }
  await router.withPlatform(async (tx) => {
    for (const verdict of verdicts) {
      await tx.query(
        `INSERT INTO audit_verifications (scope, verified_at, ok, events, broken_at) VALUES ($1, now(), $2, $3, $4)
         ON CONFLICT (scope) DO UPDATE SET verified_at = now(), ok = $2, events = $3, broken_at = $4`,
        [verdict.scope, verdict.ok, verdict.events, verdict.brokenAt ?? (verdict.error ? 'unreadable' : null)],
      )
    }
  })
  return verdicts
}

export interface ChainCheckStatus {
  scope: string
  verifiedAt: Date
  ok: boolean
  events: number
  brokenAt: string | null
}

/** The latest recorded verdict of the platform log and of each active org's log. */
export async function chainCheckStatus(tx: Pick<pg.ClientBase, 'query'>): Promise<ChainCheckStatus[]> {
  const { rows } = await tx.query<{ scope: string; verified_at: Date; ok: boolean; events: string; broken_at: string | null }>(
    `SELECT v.scope, v.verified_at, v.ok, v.events, v.broken_at FROM platform.audit_verifications v
      WHERE v.scope = $1 OR EXISTS (SELECT 1 FROM platform.orgs o WHERE o.id = v.scope AND o.status = 'active')
      ORDER BY v.scope`,
    [PLATFORM_SCOPE],
  )
  return rows.map((row) => ({
    scope: row.scope,
    verifiedAt: row.verified_at,
    ok: row.ok,
    events: Number(row.events),
    brokenAt: row.broken_at,
  }))
}
