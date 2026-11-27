// SPDX-License-Identifier: AGPL-3.0-only
import { listSyncRuns, syncStanding } from '@docket/platform-canonical-store'
import type { Tx } from '@docket/platform-tenancy'

/** Passes the Sync page shows. */
export const HISTORY_SHOWN = 40

/**
 * What moves on Settings → Sync while it is open, read from the worker's
 * bookkeeping - projection_status, the outbox and sync_runs -
 * so it is cheap to read again: no document is opened or validated. Each
 * store's lag is not here: the page's load works it out from the documents.
 */
export async function syncLive(tx: Tx, workspaceId: string) {
  const standing = await syncStanding(tx, workspaceId)
  const runs = await listSyncRuns(tx, workspaceId, HISTORY_SHOWN)
  const iso = (at: Date | null | undefined) => at?.toISOString() ?? null
  return {
    now: Date.now(),
    lastChange: iso(standing.outbox.lastDocumentChange),
    outbox: { pending: standing.outbox.pending, oldestAt: iso(standing.outbox.oldestAt), recheckPending: standing.outbox.recheckPending },
    stores: standing.instances.map((row) => ({
      id: row.instanceId,
      optional: row.optional,
      syncedAt: iso(row.syncedAt),
      attemptedAt: iso(row.attemptedAt),
      retryAt: iso(row.retryAt),
      failures: row.failures,
      error: row.lastError,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      at: run.finishedAt.toISOString(),
      tookMs: run.finishedAt.getTime() - run.startedAt.getTime(),
      triggers: run.triggers,
      ok: run.ok,
      instances: run.instances.map((instance) => ({
        ...instance,
        changes: instance.changes.map((change) => ({ ...change, title: null as string | null })),
      })),
    })),
  }
}

export type SyncLive = Awaited<ReturnType<typeof syncLive>>
