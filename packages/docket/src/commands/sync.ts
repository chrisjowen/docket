import type { MemoryAdapter } from '@docket/contracts'

import { DEFAULT_SCOPE, openDocket, type AdapterSlot } from '../adapters/docket.js'
import type { CanonicalSource } from '../canonical/source.js'
import type { ManifestStore } from '../manifest/store.js'
import type { Diagnostic, MemoryEntity } from '../model/index.js'
import { ProjectionManager, type PassReport, type TargetReport } from '../projection/manager.js'
import { recordSync } from '../sync/history.js'
import { canonicalState, type CanonicalState } from '../sync/inputs.js'
import { validate, type ValidateOptions } from './validate.js'

/**
 * How far a sync has got, as it goes: the files read and checked, the
 * instances it projects into, each one's pass as it finishes, and the
 * manifests being written.
 */
export type SyncProgress =
  | { stage: 'validating' }
  | { stage: 'projecting'; adapters: string[] }
  | { stage: 'synced'; report: PassReport }
  | { stage: 'recording' }

export interface SyncOptions extends ValidateOptions {
  /** Sync only these adapter instances, by id. Every instance enabled for projection when absent. */
  adapters?: readonly string[] | undefined
  /** Told of each stage as the sync reaches it. */
  onProgress?: ((progress: SyncProgress) => void) | undefined
}

export interface SyncResult {
  diagnostics: Diagnostic[]
  /** Entity ids any instance was handed this run, in path order. */
  upserted: string[]
  /** Entity ids any instance was told to remove: no source file is left. */
  removed: string[]
  /** Entities no instance needed to be handed again. */
  unchanged: number
  /** Each instance synced, in configuration order: what it was handed, and what failed. */
  adapters: TargetReport[]
}

/**
 * Some adapter instances failed to sync. The others synced and recorded what
 * they hold regardless; `result` says what each one did.
 */
export class SyncError extends AggregateError {
  constructor(readonly result: SyncResult) {
    const failing = result.adapters.filter(failed)
    super(
      failing.map((report) => new Error(`${report.id}: ${failureOf(report)}`)),
      `sync failed for ${failing.map((report) => report.id).join(', ')}`
    )
    this.name = 'SyncError'
  }
}

const failed = (report: TargetReport): boolean => report.error !== undefined || report.failed.length > 0

/** One line saying why an instance did not fully sync. */
export const failureOf = (report: Pick<PassReport, 'error' | 'failed'>): string => {
  if (report.error !== undefined) return report.error
  const shown = report.failed.slice(0, 3).map((failure) => `${failure.kind} ${failure.id}: ${failure.message}`)
  const more = report.failed.length > shown.length ? `; and ${report.failed.length - shown.length} more` : ''
  return `${report.failed.length} change${report.failed.length === 1 ? '' : 's'} failed - ${shown.join('; ')}${more}`
}

/**
 * Projects `state` into every instance `manager` drives and writes their
 * manifests: what `sync` does once the files are read and checked.
 */
const project = async (
  manager: ProjectionManager,
  state: CanonicalState,
  entities: readonly MemoryEntity[],
  broken: ReadonlySet<string>,
  progress: (progress: SyncProgress) => void
): Promise<Omit<SyncResult, 'diagnostics'>> => {
  try {
    progress({ stage: 'projecting', adapters: manager.ids })
    await manager.apply(state, broken, undefined, (report) => progress({ stage: 'synced', report }))
    progress({ stage: 'recording' })
    await manager.commit()
  } finally {
    await manager.close()
  }

  const adapters = manager.reports()
  const upserted = new Set(adapters.flatMap((report) => report.upserted.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)))
  const removed = new Set(adapters.flatMap((report) => report.removed.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)))
  const held = new Set(adapters.flatMap((report) => report.held))
  return {
    upserted: entities.map((entity) => entity.id).filter((id) => upserted.has(id)),
    removed: [...removed].sort(),
    unchanged: entities.filter((entity) => !upserted.has(entity.id) && !held.has(entity.id)).length,
    adapters
  }
}

interface ReconcileOptions extends SyncOptions {
  /** Reset the instances first and project everything (`docket rebuild`). */
  fresh: boolean
}

/**
 * The shared body of `sync` and `rebuild` - the two differ only in whether an
 * instance starts from its manifest or from nothing (spec §38, §39).
 *
 * Each adapter instance is planned against its own manifest and handed only
 * the input kinds it declares: entities, the observations their evidence
 * records, and their files' bodies as documents (docs/adapter-spec.md §8).
 */
export const reconcile = async (options: ReconcileOptions): Promise<SyncResult> => {
  const progress = options.onProgress ?? (() => undefined)
  progress({ stage: 'validating' })
  const { resolved, entities, documents, broken, ontology, diagnostics } = await validate(options)
  const result: SyncResult = { diagnostics, upserted: [], removed: [], unchanged: 0, adapters: [] }

  // Without a registered ontology nothing can be judged valid, so project
  // nothing rather than indexing documents of unknown standing.
  if (ontology === null) return result

  const docket = await openDocket(resolved)
  const manager = await ProjectionManager.forDocket(docket, { only: options.adapters, fresh: options.fresh })
  Object.assign(result, await project(manager, canonicalState(entities, documents, DEFAULT_SCOPE), entities, broken, progress))
  await recordSync(
    resolved,
    result.adapters.filter((report) => !failed(report)).map((report) => report.id)
  )

  if (result.adapters.some(failed)) throw new SyncError(result)
  return result
}

/** One incremental reconciliation pass over the whole repository (spec §38). */
export const sync = (options: SyncOptions = {}): Promise<SyncResult> =>
  reconcile({ ...options, fresh: false })

/**
 * An adapter instance a host syncs into: an `AdapterSlot` of an opened docket,
 * or one the host creates itself.
 */
export interface SyncTarget {
  /** The instance id its manifest is kept under. */
  readonly id: string
  /**
   * Of everything that decides what the instance projects into - its module,
   * endpoint and configuration. Its manifest vouches for what it holds only
   * while this and the sync's scope are unchanged; otherwise its namespace is
   * reset and everything projected again.
   */
  readonly fingerprint: string
  /** A fresh instance, which sync closes. */
  create(): Promise<MemoryAdapter>
}

export interface SyncSourceOptions {
  /** The Docket scope the canonical inputs and every instance are in. Defaults to `DEFAULT_SCOPE`. */
  scope?: string | undefined
  /** Reset these instances, by id (`true`: every one), and project everything into them - `docket rebuild`. */
  fresh?: boolean | ReadonlySet<string> | undefined
  /** Promote dangling references to errors, as `ValidateOptions.strict` does. */
  strict?: boolean | undefined
  /** Told of each stage as the sync reaches it. */
  onProgress?: ((progress: SyncProgress) => void) | undefined
}

/**
 * `docket sync` over a host's own storage: validates `source` as `validate`
 * does, then brings each instance up to it against its manifest in
 * `manifests` - planned, batched, retried and recorded exactly as the CLI
 * syncs a project, so a host never runs a second sync of its own. Instances
 * run independently: one that fails is reported in `SyncError.result`
 * while the others sync and record what they hold. Nothing is written but
 * the instances and their manifests.
 */
export const syncSource = async (
  source: CanonicalSource,
  manifests: ManifestStore,
  adapters: readonly SyncTarget[],
  options: SyncSourceOptions = {}
): Promise<SyncResult> => {
  const ids = adapters.map((adapter) => adapter.id)
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index)
  if (repeated !== undefined) throw new Error(`Adapter id "${repeated}" is used more than once; instance ids must be unique.`)

  const progress = options.onProgress ?? (() => undefined)
  progress({ stage: 'validating' })
  const { entities, documents, broken, ontology, diagnostics } = await validate({ source, strict: options.strict })
  const result: SyncResult = { diagnostics, upserted: [], removed: [], unchanged: 0, adapters: [] }
  // As `sync`: without a registered ontology nothing can be judged valid, so nothing is projected.
  if (ontology === null) return result

  const scope = options.scope ?? DEFAULT_SCOPE
  const slots = adapters.map(
    (adapter): AdapterSlot => ({
      id: adapter.id,
      name: adapter.id,
      source: 'registration',
      roles: ['projection'],
      fingerprint: adapter.fingerprint,
      scope,
      create: () => adapter.create()
    })
  )
  const fresh = options.fresh === true ? new Set(ids) : options.fresh === false ? undefined : options.fresh
  const manager = await ProjectionManager.open(slots, { resolved: source.resolved, store: manifests, configured: ids, fresh })
  Object.assign(result, await project(manager, canonicalState(entities, documents, scope), entities, broken, progress))

  if (result.adapters.some(failed)) throw new SyncError(result)
  return result
}
