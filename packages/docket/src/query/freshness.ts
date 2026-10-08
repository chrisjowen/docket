import type { InputKind } from '@docket/contracts'

import type { AdapterSlot, Docket } from '../adapters/docket.js'
import { Checkpoint } from '../manifest/adapter-manifest.js'
import { planAdapter } from '../manifest/plan.js'
import { loadAdapterManifests } from '../manifest/state.js'
import type { RequestSnapshot } from './snapshot.js'
import type { AdapterFreshness } from './wire.js'

export interface FreshnessInputs {
  /** The input kinds each instance declares, when it was created and described. */
  inputs?: ReadonlyMap<string, readonly InputKind[]>
  /** The checkpoint each instance reported itself - in its status or an answer's coverage. */
  reported?: ReadonlyMap<string, string | undefined>
}

/** The checkpoint of every record of `kinds` the files give - what an instance that took them all would hold. */
const canonicalCheckpoint = (snapshot: RequestSnapshot, kinds: ReadonlySet<InputKind>): string => {
  const checkpoint = new Checkpoint()
  for (const { input } of snapshot.state.inputs) if (kinds.has(input.kind)) checkpoint.add(input.kind, input.id, input.revision)
  return checkpoint.toString()
}

/**
 * How far each instance lags the files (docs/adapter-spec.md §7): the
 * coordinator's calculation, not the adapter's. An instance sync projects
 * into is judged by its manifest - the changes sync would hand it now - read
 * without connecting to it. Any other instance is current only when the
 * checkpoint it reports is the files' own; otherwise its freshness is unknown.
 */
export const freshnessOf = async (
  docket: Pick<Docket, 'resolved' | 'projectionsFingerprint'> & { adapters: readonly AdapterSlot[] },
  snapshot: RequestSnapshot,
  slots: readonly AdapterSlot[],
  known: FreshnessInputs = {}
): Promise<Map<string, AdapterFreshness>> => {
  const projected = docket.adapters.filter((slot) => slot.roles.includes('projection'))
  const manifests = await loadAdapterManifests(docket.resolved, projected, {
    legacyFingerprint: docket.projectionsFingerprint,
    configured: projected.map((slot) => slot.id)
  })

  const freshness = new Map<string, AdapterFreshness>()
  for (const slot of slots) {
    const loaded = slot.roles.includes('projection') ? manifests.get(slot.id) : undefined
    const declared = known.inputs?.get(slot.id) ?? (loaded && !loaded.reset ? loaded.manifest.inputs : undefined)
    const reported = known.reported?.get(slot.id)
    if (declared === undefined || declared.length === 0) {
      freshness.set(slot.id, { state: 'unknown', ...(reported !== undefined ? { checkpoint: reported } : {}) })
      continue
    }
    const kinds = new Set(declared)
    const files = canonicalCheckpoint(snapshot, kinds)

    if (loaded === undefined) {
      freshness.set(
        slot.id,
        reported === files
          ? { state: 'current', canonicalCheckpoint: files, checkpoint: reported }
          : { state: 'unknown', canonicalCheckpoint: files, ...(reported !== undefined ? { checkpoint: reported } : {}) }
      )
      continue
    }

    const plan = planAdapter(snapshot.state, loaded.manifest, { inputs: kinds, broken: snapshot.broken })
    // What the instance would hold once synced: broken files keep what they last projected.
    const after = Checkpoint.of(loaded.manifest.records)
    for (const { change } of plan.changes) {
      if (change.operation === 'remove') after.delete(change.kind, change.id, change.revision)
      else {
        const previous = loaded.manifest.records[change.record.kind][change.record.id]
        if (previous) after.delete(change.record.kind, change.record.id, previous.revision)
        after.add(change.record.kind, change.record.id, change.record.revision)
      }
    }
    const behind = plan.changes.length
    freshness.set(slot.id, {
      state: behind > 0 ? 'behind' : 'current',
      behind,
      canonicalCheckpoint: after.toString(),
      ...(loaded.reset ? {} : { checkpoint: loaded.manifest.checkpoint })
    })
  }
  return freshness
}

/** The diagnostic for an instance answering from an index behind the files, if it is. */
export const freshnessWarning = (id: string, freshness: AdapterFreshness | undefined): string | undefined => {
  if (freshness?.state !== 'behind') return undefined
  if (freshness.checkpoint === undefined) {
    return `${id} has not been synced with the files as they are configured now, so it may find nothing. Run \`docket sync\`.`
  }
  const changes = freshness.behind === 1 ? '1 change' : `${freshness.behind} changes`
  return `${id} is ${changes} behind the files and may miss or misstate them. Run \`docket sync\`.`
}
