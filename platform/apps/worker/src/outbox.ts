// SPDX-License-Identifier: AGPL-3.0-only
import { CLOUD_PROJECTIONS, pendingDeletions, type PendingDeletion } from '@docket/platform-canonical-store'
import { ORG_SCHEMA_VERSION, type TenantRouter } from '@docket/platform-tenancy'
import type pg from 'pg'

import type { Reconciler } from './reconcile.js'

export interface Logger {
  info(message: string): void
  error(message: string): void
}

/** Orgs the worker serves: active, with a schema this build can read. */
export async function activeOrgs(router: TenantRouter): Promise<string[]> {
  return router.withPlatform(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "SELECT id FROM platform.orgs WHERE status = 'active' AND schema_version >= $1 ORDER BY id",
      [ORG_SCHEMA_VERSION],
    )
    return rows.map((row) => row.id)
  })
}

/**
 * The org's workspaces with outbox rows waiting (§6.2), leaving out any whose
 * fixed instance failed recently and is backing off. An optional projection
 * backing off (cognee) holds up nothing here: its pass runs on its own.
 */
export async function dueWorkspaces(router: TenantRouter, orgId: string, now: Date): Promise<string[]> {
  return router.withTenant(orgId, async (tx) => {
    const { rows } = await tx.query<{ workspace_id: string }>(
      `SELECT o.workspace_id FROM outbox o
        WHERE o.processed_at IS NULL
          AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = o.workspace_id AND w.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM projection_status s WHERE s.workspace_id = o.workspace_id AND s.instance_id = ANY($2) AND s.retry_at > $1)
        GROUP BY o.workspace_id ORDER BY min(o.seq)`,
      [now, CLOUD_PROJECTIONS],
    )
    return rows.map((row) => row.workspace_id)
  })
}

export interface OutboxLoopOptions {
  router: TenantRouter
  /** For the per-workspace advisory locks and the LISTEN connection. */
  pool: pg.Pool
  reconciler: Reconciler
  log: Logger
  /** How often to look even without a notification: the fallback when one is missed. */
  intervalMs?: number
  now?: () => Date
}

export interface OutboxLoop {
  start(): void
  /** Looks for work now, for example on a notification. */
  kick(): void
  /** Stops after the workspace in hand, if any. */
  stop(): Promise<void>
  /** When the loop last finished a sweep; null before the first. */
  lastSweep(): Date | null
}

/**
 * Drains every org's outbox, one workspace at a time (§15.1 caps the
 * worker's concurrency), each under a session advisory lock so a second
 * worker never projects the same workspace at once. A notification on
 * `docket_outbox` wakes it at once; it also sweeps every `intervalMs`.
 */
export function outboxLoop(options: OutboxLoopOptions): OutboxLoop {
  const intervalMs = options.intervalMs ?? 10_000
  const now = options.now ?? (() => new Date())
  let running = false
  let stopping = false
  let again = false
  let timer: NodeJS.Timeout | undefined
  let sweeping: Promise<void> = Promise.resolve()
  let listener: pg.PoolClient | undefined
  let swept: Date | null = null

  async function withWorkspaceLock(orgId: string, workspaceId: string, fn: () => Promise<void>): Promise<boolean> {
    const client = await options.pool.connect()
    const key = `docket-cloud:reconcile:${orgId}:${workspaceId}`
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key])
      if (!rows[0]?.locked) return false
      try {
        await fn()
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
      }
      return true
    } finally {
      client.release()
    }
  }

  async function sweep(): Promise<void> {
    for (const orgId of await activeOrgs(options.router)) {
      if (stopping) return
      let due: string[]
      let deleted: PendingDeletion[]
      try {
        deleted = await options.router.withTenant(orgId, (tx) => pendingDeletions(tx, now()))
        due = await dueWorkspaces(options.router, orgId, now())
      } catch (error) {
        options.log.error(`outbox: org ${orgId}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      // A deleted workspace's projections are cleared under its reconcile lock, so a pass still projecting it finishes first.
      for (const deletion of deleted) {
        if (stopping) return
        await withWorkspaceLock(orgId, deletion.workspaceId, async () => {
          try {
            const { error } = await options.reconciler.purge(orgId, deletion)
            if (error) options.log.error(`purge org=${orgId} ws=${deletion.workspaceId}: ${error}`)
            else options.log.info(`purge org=${orgId} ws=${deletion.workspaceId} (${deletion.slug}) done`)
          } catch (error) {
            options.log.error(`purge org=${orgId} ws=${deletion.workspaceId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
      }
      for (const workspaceId of due) {
        if (stopping) return
        await withWorkspaceLock(orgId, workspaceId, async () => {
          const started = performance.now()
          try {
            const result = await options.reconciler.reconcile(orgId, workspaceId)
            const took = Math.round(performance.now() - started)
            const failing = result.instances.filter((instance) => instance.error !== undefined).map((instance) => instance.id)
            options.log.info(
              `reconcile org=${orgId} ws=${workspaceId} applied=${result.applied} failed=${result.failed} ms=${took}${failing.length ? ` failing=${failing.join(',')}` : ''}`,
            )
          } catch (error) {
            options.log.error(`reconcile org=${orgId} ws=${workspaceId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
      }
    }
  }

  function run(): void {
    if (stopping) return
    if (running) {
      again = true
      return
    }
    running = true
    sweeping = sweep()
      .catch((error: unknown) => options.log.error(`outbox sweep: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        running = false
        swept = now()
        if (again && !stopping) {
          again = false
          run()
        }
      })
  }

  async function listen(): Promise<void> {
    try {
      listener = await options.pool.connect()
      listener.on('notification', () => run())
      listener.on('error', (error) => {
        options.log.error(`outbox listener: ${error.message}; reconnecting`)
        listener?.release(true)
        listener = undefined
        if (!stopping) setTimeout(() => void listen(), 5_000).unref()
      })
      await listener.query('LISTEN docket_outbox')
    } catch (error) {
      options.log.error(`outbox listener: ${error instanceof Error ? error.message : String(error)}; polling only`)
      listener?.release(true)
      listener = undefined
      if (!stopping) setTimeout(() => void listen(), 15_000).unref()
    }
  }

  return {
    start() {
      void listen()
      timer = setInterval(run, intervalMs)
      run()
    },
    kick: run,
    async stop() {
      stopping = true
      if (timer) clearInterval(timer)
      await sweeping
      if (listener) {
        await listener.query('UNLISTEN docket_outbox').catch(() => undefined)
        listener.release()
      }
    },
    lastSweep: () => swept,
  }
}
