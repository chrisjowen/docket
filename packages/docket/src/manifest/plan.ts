import type { InputKind, RecordChange } from '@docket/contracts'

import type { MemoryEntity } from '../model/index.js'
import type { CanonicalState } from '../sync/inputs.js'
import type { AdapterManifest } from './adapter-manifest.js'
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

/** One change sync hands an adapter instance, with the entity it derives from. */
export interface PlannedChange {
  change: RecordChange
  owner: string
}

export interface AdapterPlan {
  /** Removals first - of observations and documents before entities - then upserts in canonical order. */
  changes: PlannedChange[]
  /** Records whose revision the instance already holds. */
  unchanged: number
  /** Entities a broken file holds at what the instance last acknowledged. */
  held: ReadonlySet<string>
  /** The manifest's owners once the plan is applied. */
  owners: AdapterManifest['owners']
}

export interface AdapterPlanOptions {
  /** The input kinds the instance declares; no other kind is delivered. */
  inputs: ReadonlySet<InputKind>
  /** Paths with an error, which keep what they last projected (spec §67). */
  broken: ReadonlySet<string>
  /** Plan only for these entities and what derives from them. Everything when absent. */
  scope?: ReadonlySet<string> | undefined
}

const REMOVAL_ORDER: readonly InputKind[] = ['document', 'observation', 'entity']

/**
 * What to hand one adapter instance, given the canonical inputs as they stand
 * and its manifest - `planProjection` for one instance and every input kind.
 * An entity any of whose previously read files is broken holds every record
 * derived from it, so a half-saved file changes nothing until it is fixed.
 */
export const planAdapter = (
  state: CanonicalState,
  manifest: Pick<AdapterManifest, 'owners' | 'records'>,
  options: AdapterPlanOptions
): AdapterPlan => {
  const inScope = (owner: string): boolean => options.scope === undefined || options.scope.has(owner)
  const held = new Set(
    Object.entries(manifest.owners)
      .filter(([owner, paths]) => inScope(owner) && paths.some((path) => options.broken.has(path)))
      .map(([owner]) => owner)
  )
  const plannable = (owner: string): boolean => inScope(owner) && !held.has(owner)

  const desired = new Map<string, Map<string, string>>(REMOVAL_ORDER.map((kind) => [kind, new Map()]))
  const upserts: PlannedChange[] = []
  let unchanged = 0
  for (const { input, owner } of state.inputs) {
    if (!options.inputs.has(input.kind) || !plannable(owner)) continue
    desired.get(input.kind)?.set(input.id, owner)
    const entry = manifest.records[input.kind][input.id]
    if (entry?.revision === input.revision && (entry.owner ?? input.id) === owner) unchanged += 1
    else upserts.push({ change: { operation: 'upsert', record: input }, owner })
  }

  const removals: PlannedChange[] = []
  for (const kind of REMOVAL_ORDER) {
    if (!options.inputs.has(kind)) continue
    for (const [id, entry] of Object.entries(manifest.records[kind])) {
      const owner = entry.owner ?? id
      if (!plannable(owner) || desired.get(kind)?.has(id)) continue
      removals.push({ change: { operation: 'remove', kind, id, revision: entry.revision }, owner })
    }
  }

  const owners: AdapterManifest['owners'] = {}
  for (const [owner, paths] of Object.entries(manifest.owners)) {
    if (!plannable(owner)) owners[owner] = paths
  }
  for (const [owner, paths] of state.owners) {
    if (plannable(owner)) owners[owner] = [...paths]
  }

  return { changes: [...removals, ...upserts], unchanged, held, owners }
}
