import { stateRootOf } from '../config/config.js'
import { emptyManifest } from '../manifest/manifest.js'
import { planProjection } from '../manifest/plan.js'
import { loadManifestState, saveManifest } from '../manifest/state.js'
import type { Diagnostic } from '../model/index.js'
import { ProjectionManager } from '../projection/manager.js'
import { createProjections } from '../projection/registry.js'
import { validate, type ValidateOptions } from './validate.js'

export type SyncOptions = ValidateOptions

export interface SyncResult {
  diagnostics: Diagnostic[]
  /** Ids projected this run, in path order. */
  upserted: string[]
  /** Ids in the manifest with no source file left. */
  removed: string[]
  /** Entities whose merged hash matched the manifest and were left alone. */
  unchanged: number
}

interface ReconcileOptions extends SyncOptions {
  /** Reset the projections first and project everything (`docket rebuild`). */
  fresh: boolean
}

/**
 * The shared body of `sync` and `rebuild` - the two differ only in whether they
 * start from the previous manifest or from nothing (spec §38, §39).
 */
export const reconcile = async (
  options: ReconcileOptions
): Promise<SyncResult> => {
  const { resolved, entities, broken, ontology, diagnostics } = await validate(options)
  const result: SyncResult = {
    diagnostics,
    upserted: [],
    removed: [],
    unchanged: 0
  }

  // Without a registered ontology nothing can be judged valid, so project
  // nothing rather than indexing documents of unknown standing.
  if (ontology === null) return result

  const stateRoot = stateRootOf(resolved)
  const manager = new ProjectionManager(
    createProjections(resolved.config.projections)
  )
  await manager.init({
    projectRoot: resolved.projectRoot,
    memoryRoot: resolved.memoryRoot,
    stateRoot
  })

  // A manifest written for other projections cannot say what these ones hold,
  // so that case is a rebuild too - e.g. mem0 just added to the config.
  const state = options.fresh
    ? { manifest: emptyManifest(), stale: true }
    : await loadManifestState(resolved)
  if (state.stale) await manager.reset()

  // Projections receive entities - every file that declares an id, merged -
  // so one resource is one record however many files observed it.
  const plan = planProjection(entities, broken, state.manifest.documents)

  try {
    for (const id of plan.removals) await manager.remove(id)
    for (const entity of plan.upserts) await manager.upsert(entity)

    // Once per pass, and before the manifest: the manifest vouches for what
    // the projections hold, so it must never get ahead of them.
    await manager.flush()
    await saveManifest(resolved, plan.next)
  } finally {
    await manager.close()
  }

  result.upserted = plan.upserts.map((entity) => entity.id)
  result.removed = plan.removals
  result.unchanged = plan.unchanged
  return result
}

/** One incremental reconciliation pass over the whole repository (spec §38). */
export const sync = (options: SyncOptions = {}): Promise<SyncResult> =>
  reconcile({ ...options, fresh: false })
