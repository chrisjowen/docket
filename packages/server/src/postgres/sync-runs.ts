import type { Tx } from '../ports.js'
import { enqueue } from './workspaces.js'

/**
 * The sync history: one row per reconcile pass of a
 * workspace, with what woke it and what each instance did. It names records
 * by kind and id only, never their text, and keeps the newest
 * `HISTORY_LIMIT` passes of the last `HISTORY_DAYS` days.
 */
export const HISTORY_LIMIT = 200
export const HISTORY_DAYS = 30
/** Changed records kept per instance and pass; the counts still cover every change. */
export const CHANGES_KEPT = 50

export type SyncTrigger = 'documents' | 'ontology' | 'rebuild' | 'recheck'

export interface SyncChange {
  operation: 'upsert' | 'delete'
  /** `entity`, `observation` or `document`. */
  kind: string
  id: string
}

export interface SyncInstanceRun {
  id: string
  applied: number
  failed: number
  /** Its namespace was cleared and every record projected again. */
  reset: boolean
  error?: string
  upserts: number
  deletes: number
  /** The first `CHANGES_KEPT` changes it acknowledged. */
  changes: SyncChange[]
}

export interface SyncRunInput {
  workspaceId: string
  startedAt: Date
  finishedAt: Date
  triggers: SyncTrigger[]
  ok: boolean
  instances: SyncInstanceRun[]
}

export interface SyncRun extends SyncRunInput {
  id: string
}

/** Appends a pass to the workspace's sync history and drops what is past the bound. */
export async function recordSyncRun(tx: Tx, run: SyncRunInput): Promise<void> {
  const instances = run.instances.map((instance) => ({
    ...instance,
    ...(instance.error !== undefined ? { error: instance.error.slice(0, 500) } : {}),
    changes: instance.changes.slice(0, CHANGES_KEPT)
  }))
  await tx.query(
    `INSERT INTO sync_runs (workspace_id, started_at, finished_at, triggers, ok, instances) VALUES ($1, $2, $3, $4, $5, $6)`,
    [run.workspaceId, run.startedAt, run.finishedAt, run.triggers, run.ok, JSON.stringify(instances)]
  )
  await tx.query(
    `DELETE FROM sync_runs WHERE workspace_id = $1
       AND (finished_at < now() - make_interval(days => $2)
            OR id < (SELECT min(id) FROM (SELECT id FROM sync_runs WHERE workspace_id = $1 ORDER BY id DESC LIMIT $3) kept))`,
    [run.workspaceId, HISTORY_DAYS, HISTORY_LIMIT]
  )
}

type SyncRunRow = {
  id: string
  workspace_id: string
  started_at: Date
  finished_at: Date
  triggers: SyncTrigger[]
  ok: boolean
  instances: SyncInstanceRun[]
}

/** The workspace's newest passes, newest first. */
export async function listSyncRuns(tx: Tx, workspaceId: string, limit = 50): Promise<SyncRun[]> {
  const { rows } = await tx.query<SyncRunRow>(
    'SELECT * FROM sync_runs WHERE workspace_id = $1 ORDER BY id DESC LIMIT $2',
    [workspaceId, Math.min(Math.max(limit, 1), HISTORY_LIMIT)]
  )
  return rows.map((row) => ({
    id: String(row.id),
    workspaceId: row.workspace_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    triggers: row.triggers,
    ok: row.ok,
    instances: row.instances
  }))
}

export interface ProjectionStanding {
  instanceId: string
  /** A projection the workspace turned on for itself, beside the ones every workspace has. */
  optional: boolean
  failures: number
  lastError: string | null
  attemptedAt: Date | null
  syncedAt: Date | null
  retryAt: Date | null
}

export interface OutboxStanding {
  /** Changes written but not yet projected everywhere. */
  pending: number
  /** When the oldest of them was written. */
  oldestAt: Date | null
  /** A re-check is waiting for the reconciler. */
  recheckPending: boolean
  /** When the documents last changed: every change writes an outbox row. */
  lastDocumentChange: Date | null
}

/**
 * Each instance's standing and the outbox's, as the reconciler last left
 * them: the projections `instances` names always, and `optional` ones (a
 * projection a workspace turned on for itself) beside them. Reads the
 * reconciler's bookkeeping only: no document is opened.
 */
export async function syncStanding(
  tx: Tx,
  workspaceId: string,
  instances: readonly string[],
  optional: readonly string[] = []
): Promise<{ instances: ProjectionStanding[]; outbox: OutboxStanding }> {
  const status = await tx.query<{
    instance_id: string
    failures: number
    last_error: string | null
    attempted_at: Date | null
    synced_at: Date | null
    retry_at: Date | null
  }>('SELECT instance_id, failures, last_error, attempted_at, synced_at, retry_at FROM projection_status WHERE workspace_id = $1', [workspaceId])
  const outbox = await tx.query<{ pending: string; oldest_at: Date | null; recheck: boolean; changed_at: Date | null }>(
    `SELECT count(*) FILTER (WHERE processed_at IS NULL) AS pending,
            min(created_at) FILTER (WHERE processed_at IS NULL) AS oldest_at,
            coalesce(bool_or(kind = 'recheck' AND processed_at IS NULL), false) AS recheck,
            max(created_at) FILTER (WHERE kind = 'documents') AS changed_at
       FROM outbox WHERE workspace_id = $1`,
    [workspaceId]
  )
  const rows = new Map(status.rows.map((r) => [r.instance_id, r]))
  const row = outbox.rows[0]
  return {
    instances: [...instances, ...optional.filter((id) => !instances.includes(id))].map((id) => {
      const r = rows.get(id)
      return {
        instanceId: id,
        optional: !instances.includes(id),
        failures: r?.failures ?? 0,
        lastError: r?.last_error ?? null,
        attemptedAt: r?.attempted_at ?? null,
        syncedAt: r?.synced_at ?? null,
        retryAt: r?.retry_at ?? null
      }
    }),
    outbox: {
      pending: Number(row?.pending ?? 0),
      oldestAt: row?.oldest_at ?? null,
      recheckPending: row?.recheck ?? false,
      lastDocumentChange: row?.changed_at ?? null
    }
  }
}

/**
 * Asks the reconciler for a pass now: a `recheck`
 * row in the outbox, and the backoff of any failing instance lifted so the
 * pass is not held back. It projects only what is missing; a rebuild is what
 * clears and replays the stores.
 */
export async function requestRecheck(tx: Tx, workspaceId: string): Promise<void> {
  await tx.query('UPDATE projection_status SET retry_at = NULL WHERE workspace_id = $1', [workspaceId])
  await enqueue(tx, workspaceId, 'recheck')
}
