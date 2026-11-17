import { canonicalState, planAdapter, type MemoryEntity } from '@chrisjowen/docket'

import type { MemoryDocument } from '../docket.js'
import type { Tx } from '../ports.js'
import { workspaceScope } from '../runtime/scope.js'
import { postgresManifests } from './source.js'

/** Consecutive failed passes after which a workspace shows "index behind" with the adapter's message. */
export const FAILURES_BEFORE_BEHIND = 5

/** One instance's standing, beyond docket's `{ synced, behind }`. */
export interface InstanceStatus {
  id: string
  /** Changes it has not acknowledged yet, counted per entity. */
  behind: number
  synced: boolean
  checkpoint: string | null
  syncedAt: string | null
  failures: number
  /** The adapter's last message; shown once `failures` reaches `FAILURES_BEFORE_BEHIND`. */
  error: string | null
}

/** docket's `UiIndexStatus`, with each instance's standing. */
export interface IndexStatus {
  synced: boolean
  behind: number
  instances: InstanceStatus[]
}

/** What the documents say, as `validate` read them: the entities and documents, and the paths whose errors keep them out of sync. */
export interface StatusRead {
  entities: readonly MemoryEntity[]
  documents: readonly MemoryDocument[]
  broken: ReadonlySet<string>
}

type StatusRow = {
  instance_id: string
  checkpoint: string | null
  failures: number
  last_error: string | null
  synced_at: Date | null
}

/** Each named instance's standing and the entities it lags on, read from its manifest without connecting to its store. */
export async function instanceStatuses(
  tx: Tx,
  workspaceId: string,
  read: StatusRead,
  ids: readonly string[]
): Promise<{ instances: InstanceStatus[]; lagging: Set<string> }> {
  const manifests = postgresManifests(tx, workspaceId)
  const { rows } = await tx.query<StatusRow>('SELECT instance_id, checkpoint, failures, last_error, synced_at FROM projection_status WHERE workspace_id = $1', [workspaceId])
  const standing = new Map(rows.map((row) => [row.instance_id, row]))
  const scope = workspaceScope(workspaceId)
  const state = canonicalState(read.entities, read.documents, scope)
  const lagging = new Set<string>()
  const instances: InstanceStatus[] = []
  for (const id of ids) {
    const manifest = await manifests.read(id)
    const row = standing.get(id)
    const base = {
      id,
      checkpoint: row?.checkpoint ?? null,
      syncedAt: row?.synced_at?.toISOString() ?? null,
      failures: row?.failures ?? 0,
      error: row?.last_error ?? null
    }
    // No manifest, or one left by an unfinished reset: nothing vouches for what it holds.
    if (!manifest || manifest.fingerprint.startsWith('reset-pending:') || manifest.scope !== scope) {
      for (const entity of read.entities) lagging.add(entity.id)
      instances.push({ ...base, synced: false, behind: read.entities.length })
      continue
    }
    const owners = new Set<string>()
    for (const { owner } of planAdapter(state, manifest, { inputs: new Set(manifest.inputs), broken: read.broken }).changes) {
      owners.add(owner)
      lagging.add(owner)
    }
    instances.push({ ...base, synced: true, behind: owners.size })
  }
  return { instances, lagging }
}

/**
 * How far the projections `ids` lag the canonical documents: the plan sync
 * would carry out for each instance, read from its manifest without
 * connecting to the store - `indexStatus` in `docket open`. An entity counts
 * once however many of its records, and however many instances, lag. Leave
 * out a projection search answers without, so it never makes the index
 * "behind".
 */
export async function indexStatus(tx: Tx, workspaceId: string, read: StatusRead, ids: readonly string[]): Promise<IndexStatus> {
  const { instances, lagging } = await instanceStatuses(tx, workspaceId, read, ids)
  return { synced: instances.every((instance) => instance.synced), behind: lagging.size, instances }
}
