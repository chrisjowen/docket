// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { unacknowledged } from '@chrisjowen/docket/contracts'
import type { InputKind, MemoryAdapter, ProjectionPort } from '@chrisjowen/docket/contracts'
import {
  Checkpoint,
  INPUT_KINDS,
  emptyRecords,
  resetPendingFingerprint,
} from '@chrisjowen/docket/manifest/adapter-manifest'
import { planAdapter, type PlannedChange } from '@chrisjowen/docket/manifest/plan'
import { canonicalState, type CanonicalState } from '@chrisjowen/docket/sync/inputs'
import { redactSecrets } from '@docket/platform-audit'
import {
  CHANGES_KEPT,
  CLOUD_PROJECTIONS,
  postgresManifests,
  postgresSource,
  recordPurge,
  recordSyncRun,
  validate,
  type AdapterManifest,
  type CloudProjection,
  type Keyring,
  type SyncChange,
  type SyncTrigger,
} from '@docket/platform-canonical-store'
import { openProjections, projectionFingerprint, type StoreAccess } from '@docket/platform-projections'
import { workspaceScope, type TenantRouter, type Tx } from '@docket/platform-tenancy'

/** Changes per batch, and attempts per change within one pass: docket's own (`projection/manager.ts`). */
export const BATCH_SIZE = 100
export const ATTEMPTS = 2

/** How long a workspace waits after its `n`th failed pass in a row: 30 s doubling, at most 30 min. */
export function backoffMs(failures: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1))
}

export interface ReconcileResult {
  /** Changes the projections acknowledged. */
  applied: number
  /** Changes still pending after this pass, and instances that could not be reached. */
  failed: number
  /**
   * The checkpoint the workspace reached: of every canonical record, once each
   * instance holds them all; otherwise the least any instance holds.
   */
  checkpoint: string
  instances: InstanceReport[]
}

export interface InstanceReport {
  /** A fixed projection (`CLOUD_PROJECTIONS`), or an optional one a workspace turned on (cognee). */
  id: string
  applied: number
  failed: number
  /** Its namespace was reset before projecting (a rebuild, or a manifest nothing vouches for). */
  reset: boolean
  checkpoint: string | null
  error?: string
  /** What it acknowledged: every upsert and delete counted, the first few named, for the sync history. */
  changes: { upserts: number; deletes: number; named: SyncChange[] }
}

export class ReconcileError extends Error {
  override name = 'ReconcileError'
}

export interface ReconcileDeps {
  router: TenantRouter
  keyring: Keyring
  /** The org's stores for one pass: Neo4j credentials (waking a suspended pod), a Qdrant JWT, the embedder. */
  storeAccess(orgId: string): Promise<StoreAccess>
  /** Opens one instance for the workspace. Defaults to docket's adapters on the org's stores. */
  open?(instance: CloudProjection, options: { orgId: string; workspaceId: string; access: StoreAccess }): Promise<MemoryAdapter>
  /**
   * Optional projections a deleted workspace may have used (cognee): purged
   * with the fixed ones. One whose adapter is not available is skipped, as
   * nothing can have been filed with it.
   */
  purgeAlso?: readonly { id: string; open(options: { orgId: string; workspaceId: string }): Promise<MemoryAdapter>; unavailable?(cause: unknown): boolean }[]
  /** Test seams: called after an instance applied its changes and before its manifest is written. */
  hooks?: { afterApply?(instance: string): Promise<void> | void }
  now?(): Date
}

export const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const changeRef = ({ change }: PlannedChange) =>
  change.operation === 'upsert' ? { kind: change.record.kind, id: change.record.id } : { kind: change.kind, id: change.id }

/** Splits changes into batches whose ids are unique, as receipts name changes by id alone (docket's `batchesOf`). */
function batchesOf(changes: readonly PlannedChange[]): PlannedChange[][] {
  const batches: PlannedChange[][] = []
  let batch: PlannedChange[] = []
  let ids = new Set<string>()
  for (const planned of changes) {
    const { id } = changeRef(planned)
    if (batch.length >= BATCH_SIZE || ids.has(id)) {
      batches.push(batch)
      batch = []
      ids = new Set()
    }
    batch.push(planned)
    ids.add(id)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

interface Snapshot {
  /** The newest outbox row this pass covers; rows up to it are marked processed when every instance succeeds. */
  upTo: number | null
  /** The newest pending rebuild request, if any. */
  rebuild: number | null
  /** The kinds of outbox row the pass covers: what woke it. */
  triggers: SyncTrigger[]
  /** The instances not yet reset and replayed since that request: each is reset once. */
  owesRebuild: Set<CloudProjection>
  state: CanonicalState
  broken: Set<string>
  manifests: Map<CloudProjection, AdapterManifest | undefined>
}

async function snapshot(deps: ReconcileDeps, orgId: string, workspaceId: string): Promise<Snapshot> {
  const keys = await deps.keyring.forOrg(orgId)
  return deps.router.withTenant(orgId, async (tx) => {
    // The outbox position first: any change committed before it is in the documents read next,
    // and one committed after keeps its own row pending for the next pass.
    const pending = await tx.query<{ up_to: string | null; rebuild: string | null; kinds: SyncTrigger[] | null }>(
      `SELECT max(seq) AS up_to, max(seq) FILTER (WHERE kind = 'rebuild') AS rebuild, array_agg(DISTINCT kind ORDER BY kind) AS kinds
         FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL`,
      [workspaceId],
    )
    const rebuilt = await tx.query<{ instance_id: string; rebuilt_through: string | null }>(
      'SELECT instance_id, rebuilt_through FROM projection_status WHERE workspace_id = $1',
      [workspaceId],
    )
    const validation = await validate({ source: postgresSource({ tx, keys }, workspaceId) })
    if (!validation.ontology) {
      const why = validation.diagnostics.find((d) => d.code.startsWith('ontology-'))?.message ?? 'no published ontology'
      throw new ReconcileError(`workspace ${workspaceId} cannot be projected: ${why}`)
    }
    const broken = new Set(validation.diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : [])))
    const store = postgresManifests(tx, workspaceId)
    const manifests = new Map<CloudProjection, AdapterManifest | undefined>()
    for (const id of CLOUD_PROJECTIONS) manifests.set(id, await store.read(id))
    const row = pending.rows[0]
    const rebuild = row?.rebuild === null || row?.rebuild === undefined ? null : Number(row.rebuild)
    const through = new Map(rebuilt.rows.map((r) => [r.instance_id, r.rebuilt_through === null ? 0 : Number(r.rebuilt_through)]))
    const owesRebuild = new Set(rebuild === null ? [] : CLOUD_PROJECTIONS.filter((id) => (through.get(id) ?? 0) < rebuild))
    return {
      upTo: row?.up_to === null || row?.up_to === undefined ? null : Number(row.up_to),
      rebuild,
      triggers: row?.kinds ?? [],
      owesRebuild,
      state: canonicalState(validation.entities, validation.documents, workspaceScope(workspaceId)),
      broken,
      manifests,
    }
  })
}

/** Records how an instance's pass went (§6.2): failures in a row, with backoff; a success clears them. */
export async function recordStatus(
  tx: Tx,
  workspaceId: string,
  report: InstanceReport,
  rebuilt: number | null,
  now: Date,
): Promise<void> {
  if (report.error === undefined && report.failed === 0) {
    await tx.query(
      `INSERT INTO projection_status (workspace_id, instance_id, checkpoint, failures, last_error, attempted_at, synced_at, retry_at, rebuilt_through)
       VALUES ($1, $2, $3, 0, NULL, $4, $4, NULL, $5)
       ON CONFLICT (workspace_id, instance_id) DO UPDATE SET checkpoint = EXCLUDED.checkpoint, failures = 0, last_error = NULL,
         attempted_at = EXCLUDED.attempted_at, synced_at = EXCLUDED.synced_at, retry_at = NULL,
         rebuilt_through = greatest(projection_status.rebuilt_through, EXCLUDED.rebuilt_through)`,
      [workspaceId, report.id, report.checkpoint, now, rebuilt],
    )
    return
  }
  const message = report.error ?? `${report.failed} change${report.failed === 1 ? '' : 's'} not acknowledged`
  const { rows } = await tx.query<{ failures: number }>(
    `INSERT INTO projection_status (workspace_id, instance_id, checkpoint, failures, last_error, attempted_at, rebuilt_through)
     VALUES ($1, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (workspace_id, instance_id) DO UPDATE SET checkpoint = coalesce(EXCLUDED.checkpoint, projection_status.checkpoint),
       failures = projection_status.failures + 1, last_error = EXCLUDED.last_error, attempted_at = EXCLUDED.attempted_at,
       rebuilt_through = greatest(projection_status.rebuilt_through, EXCLUDED.rebuilt_through)
     RETURNING failures`,
    [workspaceId, report.id, report.checkpoint, message.slice(0, 2_000), now, rebuilt],
  )
  const failures = rows[0]?.failures ?? 1
  await tx.query('UPDATE projection_status SET retry_at = $3 WHERE workspace_id = $1 AND instance_id = $2', [
    workspaceId,
    report.id,
    new Date(now.getTime() + backoffMs(failures)),
  ])
}

/** One instance a pass brings up to the documents: what it is, what its manifest must vouch for, and how it opens. */
export interface ProjectionTarget {
  id: string
  fingerprint: string
  /** Its manifest as the pass found it. */
  loaded: AdapterManifest | undefined
  open(): Promise<MemoryAdapter>
}

/**
 * Brings one instance up to the snapshot: docket's `ProjectionTarget` over a
 * Postgres manifest. Only what the adapter acknowledged advances the
 * manifest, and the manifest is written only after the adapter flushed, so
 * it never gets ahead of what the store holds. A crash anywhere before the
 * write replays the pass, which is safe: applying a change twice must not
 * duplicate it (adapter-spec §8).
 */
export async function projectInstance(
  deps: Pick<ReconcileDeps, 'router' | 'hooks'>,
  orgId: string,
  workspaceId: string,
  target: ProjectionTarget,
  snap: Pick<Snapshot, 'state' | 'broken'>,
  fresh: boolean,
): Promise<{ report: InstanceReport; manifest?: AdapterManifest }> {
  const instance = target.id
  const scope = workspaceScope(workspaceId)
  const { fingerprint, loaded } = target
  const reset = fresh || !loaded || loaded.fingerprint !== fingerprint || loaded.scope !== scope
  const report: InstanceReport = {
    id: instance,
    applied: 0,
    failed: 0,
    reset,
    checkpoint: loaded?.checkpoint ?? null,
    changes: { upserts: 0, deletes: 0, named: [] },
  }

  let adapter: MemoryAdapter
  try {
    adapter = await target.open()
  } catch (cause) {
    return { report: { ...report, error: `could not connect: ${messageOf(cause)}` } }
  }
  try {
    const description = adapter.describe()
    const port: ProjectionPort | undefined = adapter.projection
    if (!port) return { report: { ...report, error: 'does not project' } }
    const inputs = INPUT_KINDS.filter((kind) => description.inputs.includes(kind))
    const records = emptyRecords()
    if (!reset && loaded) for (const kind of inputs) records[kind] = { ...loaded.records[kind] }
    let manifest: AdapterManifest = {
      version: 2,
      adapter: instance,
      fingerprint,
      scope,
      definition: { name: description.name, version: description.version },
      inputs: [...inputs],
      checkpoint: '',
      owners: reset || !loaded ? {} : loaded.owners,
      records,
    }

    const checkpoint = Checkpoint.of(manifest.records)
    try {
      if (reset) {
        // Until the replay is recorded, nothing vouches for what the instance holds.
        await deps.router.withTenant(orgId, (tx) =>
          postgresManifests(tx, workspaceId).write(instance, {
            ...manifest,
            fingerprint: resetPendingFingerprint(fingerprint),
            checkpoint: Checkpoint.of(emptyRecords()).toString(),
          }),
        )
        await port.reset(scope)
      }

      const plan = planAdapter(snap.state, manifest, { inputs: new Set<InputKind>(inputs), broken: snap.broken })
      manifest = { ...manifest, owners: plan.owners }

      let pending = plan.changes
      for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt += 1) {
        const retry: PlannedChange[] = []
        const batches = batchesOf(pending)
        for (const [index, batch] of batches.entries()) {
          const next = checkpoint.copy()
          for (const { change } of batch) {
            const ref = changeRef({ change, owner: '' })
            const previous = manifest.records[ref.kind][ref.id]
            if (previous) next.delete(ref.kind, ref.id, previous.revision)
            if (change.operation === 'upsert') next.add(ref.kind, ref.id, change.record.revision)
          }
          const projection = { batchId: randomUUID(), scope, checkpoint: next.toString(), changes: batch.map(({ change }) => change) }
          let receipt
          try {
            receipt = await port.apply(projection)
          } catch (cause) {
            // A throw acknowledges nothing in the batch: it and the rest wait for the next pass.
            report.error = messageOf(cause)
            report.failed += retry.length + batches.slice(index).reduce((sum, rest) => sum + rest.length, 0)
            retry.length = 0
            break
          }
          const applied = new Set(receipt.applied)
          const failures = new Map(receipt.failed.map((failure) => [failure.id, failure]))
          for (const id of unacknowledged(projection, receipt)) failures.set(id, { id, retryable: true, message: 'not acknowledged' })
          for (const planned of batch) {
            const ref = changeRef(planned)
            const failure = failures.get(ref.id)
            if (failure) {
              if (failure.retryable && attempt < ATTEMPTS) retry.push(planned)
              else {
                report.failed += 1
                report.error ??= failure.message
              }
              continue
            }
            if (!applied.has(ref.id)) continue
            const held = manifest.records[ref.kind]
            const previous = held[ref.id]
            if (previous) checkpoint.delete(ref.kind, ref.id, previous.revision)
            if (planned.change.operation === 'upsert') {
              const { revision } = planned.change.record
              held[ref.id] = { revision, ...(planned.owner !== ref.id ? { owner: planned.owner } : {}) }
              checkpoint.add(ref.kind, ref.id, revision)
            } else {
              delete held[ref.id]
            }
            report.applied += 1
            const operation = planned.change.operation === 'upsert' ? 'upsert' : 'delete'
            if (operation === 'upsert') report.changes.upserts += 1
            else report.changes.deletes += 1
            if (report.changes.named.length < CHANGES_KEPT) report.changes.named.push({ operation, kind: ref.kind, id: ref.id })
          }
        }
        pending = retry
      }

      // A flush that fails writes nothing: what was acknowledged is replayed next pass.
      await port.flush?.()
    } catch (cause) {
      return { report: { ...report, error: messageOf(cause) } }
    }
    await deps.hooks?.afterApply?.(instance)
    manifest = { ...manifest, checkpoint: checkpoint.toString() }
    try {
      await deps.router.withTenant(orgId, (tx) => postgresManifests(tx, workspaceId).write(instance, manifest))
    } catch (cause) {
      return { report: { ...report, error: messageOf(cause) } }
    }
    return { report: { ...report, checkpoint: manifest.checkpoint }, manifest }
  } finally {
    await adapter.close().catch(() => undefined)
  }
}

/** How an instance is opened for a workspace: the given seam, or docket's adapters on the org's stores. */
function openInstance(deps: ReconcileDeps): NonNullable<ReconcileDeps['open']> {
  return (
    deps.open ??
    (async (id, options) => {
      const opened = await openProjections({ ...options, only: [id] })
      const adapter = opened[id]
      if (!adapter) throw new ReconcileError(`${id} did not open`)
      return adapter
    })
  )
}

/** The checkpoint of every canonical record the instances take: where a fully reconciled workspace stands. */
function targetCheckpoint(state: CanonicalState, kinds: ReadonlySet<InputKind>): string {
  const checkpoint = Checkpoint.of(emptyRecords())
  for (const { input } of state.inputs) if (kinds.has(input.kind)) checkpoint.add(input.kind, input.id, input.revision)
  return checkpoint.toString()
}

export interface Reconciler {
  /**
   * Brings the workspace's projections up to its canonical documents (§6.2),
   * each instance on its own: one failing never holds up the other. The
   * outbox rows the pass covered are marked processed only when every
   * instance succeeded; otherwise the workspace retries with backoff.
   */
  reconcile(orgId: string, workspaceId: string, options?: { fresh?: boolean }): Promise<ReconcileResult>
  /**
   * Clears a deleted workspace's scope from every instance (§4), and records
   * it purged; on a failure it records the error and when to try again. A
   * purge that ran before is harmless: there is nothing left to clear.
   */
  purge(orgId: string, deletion: { workspaceId: string; failures: number }): Promise<{ error?: string }>
}

export function reconciler(deps: ReconcileDeps): Reconciler {
  const now = deps.now ?? (() => new Date())
  return {
    async purge(orgId, deletion) {
      const { workspaceId } = deletion
      const errors: string[] = []
      try {
        const access = await deps.storeAccess(orgId)
        for (const instance of CLOUD_PROJECTIONS) {
          try {
            const adapter = await openInstance(deps)(instance, { orgId, workspaceId, access })
            try {
              const port = adapter.projection
              if (!port) throw new ReconcileError('does not project')
              await port.reset(workspaceScope(workspaceId))
            } finally {
              await adapter.close().catch(() => undefined)
            }
          } catch (cause) {
            errors.push(`${instance}: ${messageOf(cause)}`)
          }
        }
      } catch (cause) {
        errors.push(`the org's stores are not reachable: ${messageOf(cause)}`)
      }
      for (const optional of deps.purgeAlso ?? []) {
        try {
          const adapter = await optional.open({ orgId, workspaceId })
          try {
            const port = adapter.projection
            if (!port) throw new ReconcileError('does not project')
            await port.reset(workspaceScope(workspaceId))
          } finally {
            await adapter.close().catch(() => undefined)
          }
        } catch (cause) {
          if (!optional.unavailable?.(cause)) errors.push(`${optional.id}: ${messageOf(cause)}`)
        }
      }
      const at = now()
      const error = errors.length ? errors.join('; ') : undefined
      await deps.router.withTenant(orgId, (tx) =>
        recordPurge(tx, workspaceId, error ? { at, error, retryAt: new Date(at.getTime() + backoffMs(deletion.failures + 1)) } : { at }),
      )
      return error ? { error } : {}
    },

    async reconcile(orgId, workspaceId, options = {}) {
      const startedAt = now()
      let snap: Snapshot
      try {
        snap = await snapshot(deps, orgId, workspaceId)
      } catch (cause) {
        // A workspace that cannot be read is a failed pass of every instance, for the sync history too.
        await deps.router
          .withTenant(orgId, (tx) =>
            recordSyncRun(tx, {
              workspaceId,
              startedAt,
              finishedAt: now(),
              triggers: [],
              ok: false,
              instances: CLOUD_PROJECTIONS.map((id) => ({ id, applied: 0, failed: 0, reset: false, error: redactSecrets(messageOf(cause)), upserts: 0, deletes: 0, changes: [] })),
            }),
          )
          .catch(() => undefined)
        throw cause
      }
      let access: StoreAccess | undefined
      let accessError: string | undefined
      try {
        access = await deps.storeAccess(orgId)
      } catch (cause) {
        accessError = `the org's stores are not reachable: ${messageOf(cause)}`
      }

      const reports: InstanceReport[] = []
      const rebuilt = new Map<string, number | null>()
      const kinds = new Set<InputKind>()
      for (const instance of CLOUD_PROJECTIONS) {
        if (!access) {
          reports.push({
            id: instance,
            applied: 0,
            failed: 0,
            reset: false,
            checkpoint: snap.manifests.get(instance)?.checkpoint ?? null,
            error: accessError ?? 'unreachable',
            changes: { upserts: 0, deletes: 0, named: [] },
          })
          continue
        }
        const fresh = options.fresh === true || snap.owesRebuild.has(instance)
        const target: ProjectionTarget = {
          id: instance,
          fingerprint: projectionFingerprint(instance, workspaceId, access),
          loaded: snap.manifests.get(instance),
          open: () => openInstance(deps)(instance, { orgId, workspaceId, access: access as StoreAccess }),
        }
        const { report, manifest } = await projectInstance(deps, orgId, workspaceId, target, snap, fresh)
        for (const kind of manifest?.inputs ?? []) kinds.add(kind)
        rebuilt.set(instance, manifest && report.reset ? snap.rebuild : null)
        reports.push(report)
      }

      const ok = reports.every((report) => report.error === undefined && report.failed === 0)
      await deps.router.withTenant(orgId, async (tx) => {
        const at = now()
        for (const report of reports) await recordStatus(tx, workspaceId, report, rebuilt.get(report.id) ?? null, at)
        if (ok && snap.upTo !== null) {
          await tx.query('UPDATE outbox SET processed_at = $3 WHERE workspace_id = $1 AND seq <= $2 AND processed_at IS NULL', [
            workspaceId,
            snap.upTo,
            at,
          ])
        }
        await recordSyncRun(tx, {
          workspaceId,
          startedAt,
          finishedAt: at,
          triggers: snap.triggers,
          ok,
          instances: reports.map((report) => ({
            id: report.id,
            applied: report.applied,
            failed: report.failed,
            reset: report.reset,
            ...(report.error !== undefined ? { error: redactSecrets(report.error) } : {}),
            upserts: report.changes.upserts,
            deletes: report.changes.deletes,
            changes: report.changes.named,
          })),
        })
      })
      const checkpoints = reports.map((report) => report.checkpoint ?? '')
      return {
        applied: reports.reduce((sum, report) => sum + report.applied, 0),
        failed: reports.reduce((sum, report) => sum + report.failed + (report.error !== undefined && report.failed === 0 ? 1 : 0), 0),
        checkpoint: ok ? targetCheckpoint(snap.state, kinds) : (checkpoints.sort()[0] ?? ''),
        instances: reports,
      }
    },
  }
}
