// SPDX-License-Identifier: AGPL-3.0-only
import { enqueueRepoJob, type RepoJobKind } from '@docket/platform-github'
import type { TenantRouter } from '@docket/platform-tenancy'
import type pg from 'pg'

import { ExportError, type ExportPr } from './export-pr.js'
import { RepoSyncError, type RepoSync } from './repo-sync.js'

export interface Logger {
  info(message: string): void
  error(message: string): void
}

/** One claimed row of `platform.repo_jobs`. */
export interface RepoJob {
  id: number
  orgId: string
  connectionId: string
  kind: RepoJobKind
  fullSync: boolean
  requestedBy: string
  requests: number
  attempts: number
}

type JobRow = {
  id: string
  org_id: string
  connection_id: string
  kind: RepoJobKind
  full_sync: boolean
  requested_by: string
  requests: number
  attempts: number
}

const toJob = (row: JobRow): RepoJob => ({
  id: Number(row.id),
  orgId: row.org_id,
  connectionId: row.connection_id,
  kind: row.kind,
  fullSync: row.full_sync,
  requestedBy: row.requested_by,
  requests: row.requests,
  attempts: row.attempts,
})

/** How many times a job runs before it is given up; an export opens PRs, so it retries less. */
export const MAX_ATTEMPTS: Record<RepoJobKind, number> = { sync: 5, export: 2 }
/** A job running this long belongs to a worker that stopped: it is finished as abandoned and queued again. */
export const STALE_AFTER_MS = 15 * 60_000

/**
 * Claims the next due job whose connection has nothing running, so one
 * connection's jobs never overlap. `SKIP LOCKED` lets several workers share
 * the queue.
 */
export async function claimJob(router: TenantRouter): Promise<RepoJob | null> {
  return router.withPlatform(async (tx) => {
    const { rows } = await tx.query<JobRow>(
      `WITH next AS (
         SELECT j.id FROM platform.repo_jobs j
          WHERE j.started_at IS NULL AND j.run_after <= now()
            AND NOT EXISTS (SELECT 1 FROM platform.repo_jobs r
                             WHERE r.connection_id = j.connection_id AND r.started_at IS NOT NULL AND r.finished_at IS NULL)
          ORDER BY j.run_after, j.id
          LIMIT 1 FOR UPDATE SKIP LOCKED)
       UPDATE platform.repo_jobs j SET started_at = now(), attempts = j.attempts + 1
         FROM next WHERE j.id = next.id
       RETURNING j.*`,
    )
    return rows[0] ? toJob(rows[0]) : null
  })
}

/** Whether a failure is worth another attempt: GitHub or Postgres trouble, not a connection that is gone or blocked. */
function retryable(error: unknown): boolean {
  if (error instanceof RepoSyncError) return false
  if (error instanceof ExportError) return false
  return true
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/** Finishes a job: done, or failed. A retryable failure goes back in the queue with backoff unless a newer job already waits. */
export async function finishJob(router: TenantRouter, job: RepoJob, error?: unknown): Promise<'ok' | 'retry' | 'error'> {
  return router.withPlatform(async (tx) => {
    if (error === undefined) {
      await tx.query("UPDATE platform.repo_jobs SET finished_at = now(), outcome = 'ok', error = NULL WHERE id = $1", [job.id])
      return 'ok'
    }
    if (retryable(error) && job.attempts < MAX_ATTEMPTS[job.kind]) {
      const waiting = await tx.query('SELECT 1 FROM platform.repo_jobs WHERE connection_id = $1 AND kind = $2 AND started_at IS NULL', [
        job.connectionId,
        job.kind,
      ])
      if (!waiting.rowCount) {
        const delaySeconds = Math.min(600, 15 * 2 ** (job.attempts - 1))
        await tx.query(
          `UPDATE platform.repo_jobs SET started_at = NULL, error = $2, run_after = now() + make_interval(secs => $3) WHERE id = $1`,
          [job.id, errorText(error), delaySeconds],
        )
        return 'retry'
      }
    }
    await tx.query("UPDATE platform.repo_jobs SET finished_at = now(), outcome = 'error', error = $2 WHERE id = $1", [job.id, errorText(error)])
    return 'error'
  })
}

/** Finishes jobs a stopped worker left running, and queues each again. */
export async function requeueStale(router: TenantRouter, staleAfterMs: number = STALE_AFTER_MS): Promise<number> {
  return router.withPlatform(async (tx) => {
    const { rows } = await tx.query<JobRow>(
      `UPDATE platform.repo_jobs SET finished_at = now(), outcome = 'abandoned', error = 'the worker stopped while running it'
        WHERE started_at IS NOT NULL AND finished_at IS NULL AND started_at < now() - make_interval(secs => $1::double precision / 1000)
        RETURNING *`,
      [staleAfterMs],
    )
    for (const row of rows) {
      if (row.attempts >= MAX_ATTEMPTS[row.kind]) continue
      await enqueueRepoJob(tx, {
        orgId: row.org_id,
        connectionId: row.connection_id,
        kind: row.kind,
        full: row.full_sync,
        requestedBy: row.requested_by,
      })
    }
    return rows.length
  })
}

export interface RepoJobLoopOptions {
  router: TenantRouter
  /** For the LISTEN connection. */
  pool: pg.Pool
  sync: RepoSync
  exports: ExportPr
  log: Logger
  /** How often to look without a notification; it also finds jobs whose debounce has passed. */
  intervalMs?: number
}

export interface RepoJobLoop {
  start(): void
  kick(): void
  /** Stops after the job in hand, if any. */
  stop(): Promise<void>
  /** Runs every due job now, one at a time; resolves when none is left. For tests. */
  drain(): Promise<number>
}

/** Runs one job, recording how it ended. */
export async function runJob(options: Pick<RepoJobLoopOptions, 'router' | 'sync' | 'exports' | 'log'>, job: RepoJob): Promise<void> {
  const started = performance.now()
  const label = `${job.kind} org=${job.orgId} connection=${job.connectionId} job=${job.id}`
  try {
    if (job.kind === 'sync') {
      const event = await options.sync.syncConnection(job.connectionId, { full: job.fullSync })
      if (!event) {
        options.log.info(`${label} already synced at the branch head requests=${job.requests} ms=${Math.round(performance.now() - started)}`)
        await finishJob(options.router, job)
        return
      }
      const counts = { upserted: 0, retired: 0, exported: 0, adopted: 0 }
      for (const document of event.documents) counts[document.change] += 1
      options.log.info(
        `${label} commit=${event.commit?.slice(0, 7)} upserted=${counts.upserted} retired=${counts.retired} exported=${counts.exported} notices=${event.notices.length} requests=${job.requests} ms=${Math.round(performance.now() - started)}`,
      )
    } else {
      const result = await options.exports.exportConnection(job.connectionId, { requestedBy: job.requestedBy })
      options.log.info(`${label} pr=${result.prUrl} documents=${result.documents} ms=${Math.round(performance.now() - started)}`)
    }
    await finishJob(options.router, job)
  } catch (error) {
    const outcome = await finishJob(options.router, job, error).catch(() => 'error' as const)
    options.log.error(`${label} attempt=${job.attempts} ${outcome === 'retry' ? 'will retry' : 'failed'}: ${errorText(error)}`)
  }
}

/**
 * Drains `platform.repo_jobs` one job at a time (§15.1 caps the worker's
 * concurrency). A notification on `docket_repo_jobs` wakes it; it also looks
 * every `intervalMs`, which is when a push's debounce runs out.
 */
export function repoJobLoop(options: RepoJobLoopOptions): RepoJobLoop {
  const intervalMs = options.intervalMs ?? 2_000
  let running = false
  let again = false
  let stopping = false
  let timer: NodeJS.Timeout | undefined
  let listener: pg.PoolClient | undefined
  let current: Promise<void> = Promise.resolve()
  let lastStaleCheck = 0

  async function drain(): Promise<number> {
    let ran = 0
    if (Date.now() - lastStaleCheck > 60_000) {
      lastStaleCheck = Date.now()
      const stale = await requeueStale(options.router)
      if (stale) options.log.error(`repo jobs: ${stale} job(s) left running by a stopped worker were queued again`)
    }
    while (!stopping) {
      const job = await claimJob(options.router)
      if (!job) break
      await runJob(options, job)
      ran += 1
    }
    return ran
  }

  function run(): void {
    if (stopping) return
    if (running) {
      again = true
      return
    }
    running = true
    current = drain()
      .then(() => undefined)
      .catch((error: unknown) => options.log.error(`repo jobs: ${errorText(error)}`))
      .finally(() => {
        running = false
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
        options.log.error(`repo jobs listener: ${error.message}; reconnecting`)
        listener?.release(true)
        listener = undefined
        if (!stopping) setTimeout(() => void listen(), 5_000).unref()
      })
      await listener.query('LISTEN docket_repo_jobs')
    } catch (error) {
      options.log.error(`repo jobs listener: ${errorText(error)}; polling only`)
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
      await current
      if (listener) {
        await listener.query('UNLISTEN docket_repo_jobs').catch(() => undefined)
        listener.release()
      }
    },
    drain,
  }
}
