// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit } from '@docket/platform-audit'
import { COGNEE } from '@docket/platform-canonical-store'
import type { TenantRouter, Tx } from '@docket/platform-tenancy'

import { recordStatus } from './reconcile.js'

/**
 * The cognify lease (platform migration 0010): whose cognify the shared
 * cognee service is running now. The worker takes it before a cognee pass or
 * purge; the cognify gateway counts each model call cognee makes - all on
 * the platform's own OpenRouter key - to the lease's org and workspace, for
 * their cap and cognee limit, and refuses calls while no one holds it. One at
 * a time across the platform. A pass renews it before each batch. Once it
 * lapses - the pass ended, or its worker stopped - it is given up only when
 * cognee says the holder's dataset is no longer cognifying: a cognify the
 * adapter stopped waiting for runs on in cognee, and stays counted to its own
 * workspace, never to the next one.
 */
export interface CognifyLease {
  orgId: string
  workspaceId: string
  monthlyLimitUsd: number
  startedAt: Date
  expiresAt: Date
  stuckAt: Date | null
}

type Holder = Pick<CognifyLease, 'orgId' | 'workspaceId' | 'startedAt'>

/** Takes the lease for a workspace if no one holds it; false while anyone does. */
export async function takeLease(
  tx: Tx,
  lease: { orgId: string; workspaceId: string; monthlyLimitUsd: number; now: Date; forMs: number },
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO platform.cognify_lease (id, org_id, workspace_id, monthly_limit_usd, started_at, expires_at)
     VALUES (true, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [lease.orgId, lease.workspaceId, lease.monthlyLimitUsd, lease.now, new Date(lease.now.getTime() + lease.forMs)],
  )
  return rowCount === 1
}

/** Moves the holder's lease to lapse at `until`; false if it no longer holds it. */
async function renewLease(tx: Tx, holder: Holder, until: Date): Promise<boolean> {
  const { rowCount } = await tx.query('UPDATE platform.cognify_lease SET expires_at = $4 WHERE org_id = $1 AND workspace_id = $2 AND started_at = $3', [
    holder.orgId,
    holder.workspaceId,
    holder.startedAt,
    until,
  ])
  return rowCount === 1
}

/** Gives the lease up, if this holder still holds it. */
async function returnLease(tx: Tx, holder: Holder): Promise<void> {
  await tx.query('DELETE FROM platform.cognify_lease WHERE org_id = $1 AND workspace_id = $2 AND started_at = $3', [holder.orgId, holder.workspaceId, holder.startedAt])
}

/** Who holds the lease now, lapsed or not: the workspace cognee's model calls are counted to. */
export async function currentLease(tx: Tx): Promise<CognifyLease | null> {
  const { rows } = await tx.query<{ org_id: string; workspace_id: string; monthly_limit_usd: string; started_at: Date; expires_at: Date; stuck_at: Date | null }>(
    'SELECT org_id, workspace_id, monthly_limit_usd, started_at, expires_at, stuck_at FROM platform.cognify_lease',
  )
  const row = rows[0]
  return row
    ? {
        orgId: row.org_id,
        workspaceId: row.workspace_id,
        monthlyLimitUsd: Number(row.monthly_limit_usd),
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        stuckAt: row.stuck_at,
      }
    : null
}

export interface LeaseKeeperOptions {
  router: TenantRouter
  /** How long a hold lasts between renewals: longer than one batch's cognify. */
  leaseMs: number
  /** How long a cognify may run on in cognee after its hold lapsed before its workspace is shown stuck on Settings → Sync. */
  stuckAfterMs?: number
  now: () => Date
  /** Whether cognee is cognifying the workspace's dataset now; throws when cognee cannot say. */
  cognifying(orgId: string, workspaceId: string): Promise<boolean>
}

/** A workspace's hold on the lease. */
export interface HeldLease {
  /** Holds the lease another `leaseMs`; throws if it was lost. */
  renew(): Promise<void>
  /** Ends the hold: the lease is given up once cognee says the workspace's cognify is over, and stays its own until then. */
  release(): Promise<void>
}

export interface LeaseKeeper {
  /**
   * Takes the lease for a workspace's cognify, or null while another
   * workspace's cognify holds it. Throws `StaleCognify` when cognee reports
   * the workspace's dataset cognifying though no one held the lease.
   */
  take(lease: { orgId: string; workspaceId: string; monthlyLimitUsd: number }): Promise<HeldLease | null>
  /** Takes the lease to clear a workspace's dataset, which cognifies nothing: released, it is given up at once. */
  takeToClear(lease: { orgId: string; workspaceId: string }): Promise<HeldLease | null>
}

/**
 * cognee reports a cognify of the workspace's dataset that no pass holds the
 * lease for - one cut short, say by cognee restarting - so cognifying again
 * would hold the lease for good. An operator ends it in cognee.
 */
export class StaleCognify extends Error {
  override name = 'StaleCognify'
}

export function leaseKeeper(options: LeaseKeeperOptions): LeaseKeeper {
  const { router, leaseMs, now } = options
  const stuckAfterMs = options.stuckAfterMs ?? 6 * 3_600_000

  /** Gives up a lapsed lease whose cognify is over; true when the lease is free. */
  async function settle(): Promise<boolean> {
    const held = await router.withPlatform((tx) => currentLease(tx))
    if (!held) return true
    const at = now()
    if (held.expiresAt > at) return false
    const running = await options.cognifying(held.orgId, held.workspaceId).catch(() => null)
    if (running === false) {
      await router.withPlatform((tx) => returnLease(tx, held))
      return true
    }
    if (!held.stuckAt && at.getTime() - held.expiresAt.getTime() >= stuckAfterMs) {
      const hours = Math.round(stuckAfterMs / 360_000) / 10
      const error =
        running === null
          ? `cognee cannot say whether this workspace's cognify is over, ${hours} h after its pass ended; no other cognify runs until it does`
          : `cognee is still cognifying this workspace ${hours} h after its pass ended; no other cognify runs until it finishes`
      await router
        .withTenant(held.orgId, (tx) =>
          recordStatus(tx, held.workspaceId, { id: COGNEE, applied: 0, failed: 0, reset: false, checkpoint: null, error, changes: { upserts: 0, deletes: 0, named: [] } }, null, at),
        )
        .catch(() => undefined)
      await router.withPlatform((tx) =>
        tx.query('UPDATE platform.cognify_lease SET stuck_at = $4 WHERE org_id = $1 AND workspace_id = $2 AND started_at = $3', [held.orgId, held.workspaceId, held.startedAt, at]),
      )
    }
    return false
  }

  async function hold(lease: { orgId: string; workspaceId: string; monthlyLimitUsd: number }, cognifies: boolean): Promise<HeldLease | null> {
    if (!(await settle())) return null
    const startedAt = now()
    if (!(await router.withPlatform((tx) => takeLease(tx, { ...lease, now: startedAt, forMs: leaseMs })))) return null
    const holder: Holder = { orgId: lease.orgId, workspaceId: lease.workspaceId, startedAt }
    if (cognifies && (await options.cognifying(lease.orgId, lease.workspaceId).catch(() => false))) {
      await router.withPlatform((tx) => returnLease(tx, holder))
      throw new StaleCognify(
        "cognee reports this workspace's dataset still cognifying from a run no pass holds, so cognee waits; a platform operator must end that run in cognee (docs/cognee.md)",
      )
    }
    return {
      async renew() {
        if (!(await router.withPlatform((tx) => renewLease(tx, holder, new Date(now().getTime() + leaseMs))))) {
          throw new Error('the cognify lease lapsed and was given up: the pass stops here and the rest waits for the next one')
        }
      },
      async release() {
        if (!cognifies) await router.withPlatform((tx) => returnLease(tx, holder))
        else if (await router.withPlatform((tx) => renewLease(tx, holder, now()))) await settle()
      },
    }
  }

  return {
    take: (lease) => hold(lease, true),
    takeToClear: (lease) => hold({ ...lease, monthlyLimitUsd: 0 }, false),
  }
}

/** What the operator's release did: the lease it gave up, or why it refused. */
export type LeaseRelease = { released: CognifyLease } | { refused: string }

/**
 * The operator's way out of a stuck cognify lease (docs/cognee.md), for when
 * cognee cannot say whether the stuck workspace's cognify is over. While
 * cognee says it is still cognifying, it refuses: the run is ended in cognee
 * first, and the lease is then given up on its own; so it does once cognee
 * says the run is over. Releasing a cognify cognee is in fact still running
 * would count its remaining model calls to the next holder. Once released,
 * the workspace's cognee is recorded failed and due again, so it shows why
 * and retries with backoff, and the release is audited in the platform's log
 * and the org's. Refuses a lease not shown stuck: a running pass holds it.
 */
export async function releaseStuckLease(
  router: TenantRouter,
  options: { by: string; cognifying(orgId: string, workspaceId: string): Promise<boolean>; now?: Date },
): Promise<LeaseRelease> {
  const at = options.now ?? new Date()
  const held = await router.withPlatform((tx) => currentLease(tx))
  if (!held) return { refused: 'no cognify lease is held' }
  if (!held.stuckAt) return { refused: `org ${held.orgId} workspace ${held.workspaceId} holds the lease, but it is not shown stuck` }
  const running = await options.cognifying(held.orgId, held.workspaceId).catch(() => null)
  if (running === true) {
    return { refused: "cognee reports the stuck workspace's dataset still cognifying: end that run in cognee first, and the lease is given up on its own (docs/cognee.md)" }
  }
  if (running === false) return { refused: 'cognee reports the run over: the next cognee pass gives the lease up on its own' }
  const event = { actor: `system:operator:${options.by}` as const, action: 'cognee.lease.release', outcome: 'ok' as const, latencyMs: 0, requestId: randomUUID() }
  await router.withPlatform(async (tx) => {
    await returnLease(tx, held)
    await audit(tx, { ...event, orgId: held.orgId, workspaceId: held.workspaceId })
  })
  const error = "A platform operator released this workspace's stuck cognify lease; cognee files and cognifies it again on its next pass"
  try {
    await router.withTenant(held.orgId, async (tx) => {
      const { rowCount } = await tx.query('SELECT 1 FROM workspaces WHERE id = $1', [held.workspaceId])
      if (rowCount) {
        await recordStatus(tx, held.workspaceId, { id: COGNEE, applied: 0, failed: 0, reset: false, checkpoint: null, error, changes: { upserts: 0, deletes: 0, named: [] } }, null, at)
        await tx.query('UPDATE cognee_settings SET projected_through = NULL WHERE workspace_id = $1', [held.workspaceId])
      }
      await audit(tx, { ...event, orgId: held.orgId, workspaceId: held.workspaceId, target: [`workspace:${held.workspaceId}`] })
    })
  } catch (cause) {
    throw new Error(
      `the lease was released and audited in the platform's log, but recording it for the org failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  return { released: held }
}
