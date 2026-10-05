import type { MemoryEntity } from '../model/index.js'
import { entryPaths, type IndexManifest, type ManifestEntry } from './manifest.js'

export interface ProjectionPlan {
  /** Entities whose merged hash differs from what was last projected, in input order. */
  upserts: MemoryEntity[]
  /** Previously projected ids with nothing left to project and nothing held. */
  removals: string[]
  /** Entities whose hash matched and were left alone. */
  unchanged: number
  /** The manifest once the plan is applied. */
  next: IndexManifest['documents']
}

export const manifestEntry = (entity: MemoryEntity): ManifestEntry => ({
  path: entity.path,
  ...(entity.paths.length > 1 ? { paths: entity.paths } : {}),
  hash: entity.hash
})

/**
 * Decides what to hand the projections, given the entities as they stand and
 * what the manifest says was projected before.
 *
 * Spec §67: a file that is currently broken keeps its previous projection
 * rather than having it erased. With several files per id, that holds the
 * whole entity: an id any of whose previously projected files is broken keeps
 * its previous projection until the file is fixed, since merging without it
 * would erase what it contributed. `broken` is keyed by path because a file
 * that failed to parse never produced an id.
 */
export const planProjection = (
  entities: readonly MemoryEntity[],
  broken: ReadonlySet<string>,
  previous: Readonly<IndexManifest['documents']>
): ProjectionPlan => {
  const held = new Set(
    Object.entries(previous)
      .filter(([, entry]) => entryPaths(entry).some((path) => broken.has(path)))
      .map(([id]) => id)
  )

  const plan: ProjectionPlan = { upserts: [], removals: [], unchanged: 0, next: {} }

  for (const entity of entities) {
    if (held.has(entity.id)) continue
    plan.next[entity.id] = manifestEntry(entity)
    // The hash covers the paths, so a moved file is reprojected too.
    if (previous[entity.id]?.hash === entity.hash) plan.unchanged += 1
    else plan.upserts.push(entity)
  }

  for (const [id, entry] of Object.entries(previous)) {
    if (plan.next[id]) continue
    if (held.has(id)) plan.next[id] = entry
    else plan.removals.push(id)
  }

  return plan
}
