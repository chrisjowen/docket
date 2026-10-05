import { stateRootOf } from '../config/config.js'
import { emptyManifest, type IndexManifest } from '../manifest/manifest.js'
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
  /** Ids in the manifest whose source file is gone. */
  removed: string[]
  /** Documents whose hash matched the manifest and were left alone. */
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
  const { resolved, documents, ontology, diagnostics } = await validate(options)
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
  const previous = state.manifest
  if (state.stale) await manager.reset()

  // Spec §67: a file that is currently broken keeps its previous projection
  // rather than having it erased. Keyed by path because a file that failed to
  // parse never produced an id.
  const broken = new Set(
    diagnostics
      .filter((d) => d.severity === 'error' && d.path !== undefined)
      .map((d) => d.path as string)
  )

  const next: IndexManifest = emptyManifest()

  try {
    for (const document of documents) {
      if (broken.has(document.path)) continue

      const before = previous.documents[document.id]
      if (before?.hash === document.hash && before.path === document.path) {
        next.documents[document.id] = before
        result.unchanged += 1
        continue
      }

      await manager.upsert(document)
      next.documents[document.id] = {
        path: document.path,
        hash: document.hash
      }
      result.upserted.push(document.id)
    }

    for (const [id, entry] of Object.entries(previous.documents)) {
      if (next.documents[id]) continue
      if (broken.has(entry.path)) {
        next.documents[id] = entry
        continue
      }
      await manager.remove(id)
      result.removed.push(id)
    }

    // Once per pass, and before the manifest: the manifest vouches for what
    // the projections hold, so it must never get ahead of them.
    await manager.flush()
    await saveManifest(resolved, next.documents)
  } finally {
    await manager.close()
  }

  return result
}

/** One incremental reconciliation pass over the whole repository (spec §38). */
export const sync = (options: SyncOptions = {}): Promise<SyncResult> =>
  reconcile({ ...options, fresh: false })
