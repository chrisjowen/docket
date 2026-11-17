import type { ScopeSource, StoreRunner } from '../ports.js'
import type { Pool, PoolClient } from '../postgres/db.js'
import { pendingDeletions, type PendingDeletion } from '../postgres/workspaces.js'
import type { Reconciler } from './reconcile.js'
import { redactSecrets } from './scope.js'

const logMessage = (error: unknown): string => redactSecrets(error instanceof Error ? error.message : String(error))

export interface Logger {
  info(message: string): void
  error(message: string): void
}

/**
 * The store's workspaces with outbox rows waiting, oldest first, leaving out
 * any whose `instances` failed recently and are backing off. A projection not
 * in `instances` backing off holds up nothing here.
 */
export async function dueWorkspaces(store: StoreRunner, instances: readonly string[], now: Date): Promise<string[]> {
  return store.run(async ({ tx }) => {
    const { rows } = await tx.query<{ workspace_id: string }>(
      `SELECT o.workspace_id FROM outbox o
        WHERE o.processed_at IS NULL
          AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = o.workspace_id AND w.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM projection_status s WHERE s.workspace_id = o.workspace_id AND s.instance_id = ANY($2) AND s.retry_at > $1)
        GROUP BY o.workspace_id ORDER BY min(o.seq)`,
      [now, instances]
    )
    return rows.map((row) => row.workspace_id)
  })
}

export interface OutboxLoopOptions {
  /** The stores to drain, visited in turn on every sweep. */
  scopes: ScopeSource
  /**
   * A pool on the database the stores are in, for the per-workspace advisory
   * locks that keep a second process from projecting a workspace at once, and
   * the connection that listens for `channel`.
   */
  pool: Pool
  reconciler: Reconciler
  /** The projections a pass brings up to date: one backing off holds its workspace back. */
  instances: readonly string[]
  log: Logger
  /** How often to look even without a notification: the fallback when one is missed. */
  intervalMs?: number
  /** The `NOTIFY` channel that wakes the loop; `docket_outbox` by default. */
  channel?: string
  now?: () => Date
}

export interface OutboxLoop {
  start(): void
  /** Looks for work now, for example after a write. */
  kick(): void
  /** Stops after the workspace in hand, if any. */
  stop(): Promise<void>
  /** When the loop last finished a sweep; null before the first. */
  lastSweep(): Date | null
}

/** A pooled client that can listen: a `pg` client is one. */
interface Listener extends PoolClient {
  on(event: 'notification', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

const listens = (client: PoolClient): client is Listener => typeof (client as Partial<Listener>).on === 'function'

/**
 * Drains every store's outbox, one workspace at a time, each under a session
 * advisory lock so a second process never projects the same workspace at
 * once. Deleted workspaces are purged from the projections first, under the
 * same lock, so a pass still projecting one finishes before it is cleared. A
 * notification on `channel` wakes it at once; it also sweeps every
 * `intervalMs`.
 */
export function outboxLoop(options: OutboxLoopOptions): OutboxLoop {
  const intervalMs = options.intervalMs ?? 10_000
  const channel = options.channel ?? 'docket_outbox'
  const now = options.now ?? (() => new Date())
  let running = false
  let stopping = false
  let again = false
  let timer: NodeJS.Timeout | undefined
  let sweeping: Promise<void> = Promise.resolve()
  let listener: Listener | undefined
  let swept: Date | null = null

  async function withWorkspaceLock(scopeId: string, workspaceId: string, fn: () => Promise<void>): Promise<boolean> {
    const client = await options.pool.connect()
    const key = `docket-cloud:reconcile:${scopeId}:${workspaceId}`
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
    for (const scope of await options.scopes.scopes()) {
      if (stopping) return
      let due: string[]
      let deleted: PendingDeletion[]
      try {
        deleted = await scope.store.run(({ tx }) => pendingDeletions(tx, now()))
        due = await dueWorkspaces(scope.store, options.instances, now())
      } catch (error) {
        options.log.error(`outbox: ${scope.id}: ${logMessage(error)}`)
        continue
      }
      for (const deletion of deleted) {
        if (stopping) return
        await withWorkspaceLock(scope.id, deletion.workspaceId, async () => {
          try {
            const { error } = await options.reconciler.purge(scope, deletion)
            if (error) options.log.error(`purge ${scope.id} ws=${deletion.workspaceId}: ${error}`)
            else options.log.info(`purge ${scope.id} ws=${deletion.workspaceId} (${deletion.slug}) done`)
          } catch (error) {
            options.log.error(`purge ${scope.id} ws=${deletion.workspaceId}: ${logMessage(error)}`)
          }
        })
      }
      for (const workspaceId of due) {
        if (stopping) return
        await withWorkspaceLock(scope.id, workspaceId, async () => {
          const started = performance.now()
          try {
            const result = await options.reconciler.reconcile(scope, workspaceId)
            const took = Math.round(performance.now() - started)
            const failing = result.instances.filter((instance) => instance.error !== undefined).map((instance) => instance.id)
            options.log.info(
              `reconcile ${scope.id} ws=${workspaceId} applied=${result.applied} failed=${result.failed} ms=${took}${failing.length ? ` failing=${failing.join(',')}` : ''}`
            )
          } catch (error) {
            options.log.error(`reconcile ${scope.id} ws=${workspaceId}: ${logMessage(error)}`)
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
      .catch((error: unknown) => options.log.error(`outbox sweep: ${logMessage(error)}`))
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
    let client: PoolClient | undefined
    try {
      client = await options.pool.connect()
      if (!listens(client)) {
        client.release()
        return
      }
      const held = client
      listener = held
      held.on('notification', () => run())
      held.on('error', (error) => {
        options.log.error(`outbox listener: ${logMessage(error)}; reconnecting`)
        held.release(true)
        listener = undefined
        if (!stopping) setTimeout(() => void listen(), 5_000).unref()
      })
      await held.query(`LISTEN ${channel}`)
    } catch (error) {
      options.log.error(`outbox listener: ${logMessage(error)}; polling only`)
      client?.release(true)
      listener = undefined
      if (!stopping) setTimeout(() => void listen(), 15_000).unref()
    }
  }

  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(channel)) throw new Error(`not a safe channel name: ${JSON.stringify(channel)}`)
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
        await listener.query(`UNLISTEN ${channel}`).catch(() => undefined)
        listener.release()
      }
    },
    lastSweep: () => swept
  }
}
