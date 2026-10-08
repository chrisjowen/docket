import { DEFAULT_SCOPE, openDocket } from '../adapters/docket.js'
import type { Diagnostic } from '../model/index.js'
import { ProjectionManager, type PassReport, type TargetReport } from '../projection/manager.js'
import { canonicalState } from '../sync/inputs.js'
import { validate, type ValidateOptions } from './validate.js'

export interface SyncOptions extends ValidateOptions {
  /** Sync only these adapter instances, by id. Every instance enabled for projection when absent. */
  adapters?: readonly string[] | undefined
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
  const { resolved, entities, documents, broken, ontology, diagnostics } = await validate(options)
  const result: SyncResult = { diagnostics, upserted: [], removed: [], unchanged: 0, adapters: [] }

  // Without a registered ontology nothing can be judged valid, so project
  // nothing rather than indexing documents of unknown standing.
  if (ontology === null) return result

  const docket = await openDocket(resolved)
  const manager = await ProjectionManager.forDocket(docket, { only: options.adapters, fresh: options.fresh })
  try {
    await manager.apply(canonicalState(entities, documents, DEFAULT_SCOPE), broken)
    await manager.commit()
  } finally {
    await manager.close()
  }

  result.adapters = manager.reports()
  const upserted = new Set(result.adapters.flatMap((report) => report.upserted.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)))
  const removed = new Set(result.adapters.flatMap((report) => report.removed.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)))
  const held = new Set(result.adapters.flatMap((report) => report.held))
  result.upserted = entities.map((entity) => entity.id).filter((id) => upserted.has(id))
  result.removed = [...removed].sort()
  result.unchanged = entities.filter((entity) => !upserted.has(entity.id) && !held.has(entity.id)).length

  if (result.adapters.some(failed)) throw new SyncError(result)
  return result
}

/** One incremental reconciliation pass over the whole repository (spec §38). */
export const sync = (options: SyncOptions = {}): Promise<SyncResult> =>
  reconcile({ ...options, fresh: false })
