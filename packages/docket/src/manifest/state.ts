import { rm } from 'node:fs/promises'

import { stateRootOf, type ResolvedConfig } from '../config/config.js'
import { ADAPTER_MANIFEST_VERSION, checkpointOf, emptyRecords, resetPendingFingerprint, type AdapterManifest } from './adapter-manifest.js'
import { entryPaths, manifestPath, readManifest } from './manifest.js'
import { fileManifestStore, type ManifestStore } from './store.js'

/**
 * Where an instance's manifest came from this run:
 *
 * - `current`: its own, written for its present configuration.
 * - `migrated`: the single manifest docket kept for every projection before
 *   each instance had its own, written for exactly the projections configured
 *   now - its entity records carry over, so nothing is reprojected.
 * - `adopted`: the manifest of an instance id no longer configured, written for
 *   this instance's exact module, configuration and scope - a renamed instance.
 * - `created`: none was found, so nothing is known of what the instance holds.
 * - `reconfigured`: its own, written for another endpoint, scope or configuration.
 * - `interrupted`: its own, left by a reset or rebuild that never finished -
 *   one that threw, was interrupted, or whose flush failed.
 * - `rebuilt`: `docket rebuild` discards it.
 */
export type ManifestOrigin = 'current' | 'migrated' | 'adopted' | 'created' | 'reconfigured' | 'interrupted' | 'rebuilt'

/** What identifies an adapter instance's manifest. */
export interface ManifestIdentity {
  id: string
  /** The instance's configuration fingerprint (`AdapterSlot.fingerprint`). */
  fingerprint: string
  scope: string
}

export interface LoadedManifest {
  /** What the instance holds as far as sync knows. Empty when it must be reset. */
  manifest: AdapterManifest
  origin: ManifestOrigin
  /**
   * Nothing vouches for what the instance holds, so its namespace is reset
   * and everything projected again - reconciliation, for that instance alone.
   */
  reset: boolean
  /** The orphaned instance manifest it was adopted from, removed once this one is written. */
  adoptedFrom?: string
}

export interface LoadManifestsOptions {
  /** `Docket.projectionsFingerprint`, which the single legacy manifest was keyed by. */
  legacyFingerprint: string
  /** Every instance `.docket.yaml` enables for projection: a manifest named for any other is an orphan. */
  configured: readonly string[]
  /** Instances `docket rebuild` resets: `true` for every one. */
  fresh?: boolean | ReadonlySet<string> | undefined
  /** Where the instance manifests are. Defaults to the files under the project's state root. */
  store?: ManifestStore | undefined
}

/** The files under the project's state root, where every instance's manifest has always been. */
export const projectManifestStore = (resolved: ResolvedConfig): ManifestStore => fileManifestStore(stateRootOf(resolved))

const empty = (identity: ManifestIdentity): AdapterManifest => {
  const records = emptyRecords()
  return {
    version: ADAPTER_MANIFEST_VERSION,
    adapter: identity.id,
    fingerprint: identity.fingerprint,
    scope: identity.scope,
    definition: { name: '', version: '' },
    inputs: [],
    checkpoint: checkpointOf(records),
    owners: {},
    records
  }
}

const vouchesFor = (manifest: AdapterManifest, identity: ManifestIdentity): boolean =>
  manifest.fingerprint === identity.fingerprint && manifest.scope === identity.scope

/**
 * Each instance's manifest, deciding for each whether what it records can be
 * trusted (docs/adapter-spec.md §8). One instance's manifest never stands in
 * for another's, except an orphan adopted by a renamed instance, which is
 * the same target by fingerprint.
 *
 * The legacy single manifest is migrated rather than discarded where it
 * still vouches for the configured projections, so upgrading reprojects
 * nothing that was projected before. Its records are entities only: input
 * kinds an instance had never been handed are projected as new.
 */
export const loadAdapterManifests = async (
  resolved: ResolvedConfig,
  identities: readonly ManifestIdentity[],
  options: LoadManifestsOptions
): Promise<Map<string, LoadedManifest>> => {
  const store = options.store ?? projectManifestStore(resolved)
  const configured = new Set(options.configured)
  const fresh = (id: string): boolean =>
    options.fresh === true || (options.fresh instanceof Set && options.fresh.has(id))

  const orphans = new Map<string, AdapterManifest>()
  for (const id of await store.list()) {
    if (configured.has(id) || identities.some((identity) => identity.id === id)) continue
    const orphan = await store.read(id)
    if (orphan) orphans.set(id, orphan)
  }

  // The single manifest docket kept before each instance had its own was only ever a file.
  let legacy: Awaited<ReturnType<typeof readManifest>> | undefined
  const readLegacy = async () => {
    legacy ??= await readManifest(stateRootOf(resolved))
    return legacy.projections === options.legacyFingerprint ? legacy : undefined
  }

  const loaded = new Map<string, LoadedManifest>()
  for (const identity of identities) {
    if (fresh(identity.id)) {
      loaded.set(identity.id, { manifest: empty(identity), origin: 'rebuilt', reset: true })
      continue
    }

    const own = await store.read(identity.id)
    if (own && vouchesFor(own, identity)) {
      loaded.set(identity.id, { manifest: own, origin: 'current', reset: false })
      continue
    }
    if (own) {
      const interrupted = own.fingerprint === resetPendingFingerprint(identity.fingerprint) && own.scope === identity.scope
      loaded.set(identity.id, { manifest: empty(identity), origin: interrupted ? 'interrupted' : 'reconfigured', reset: true })
      continue
    }

    const adoptable = [...orphans].find(([, orphan]) => vouchesFor(orphan, identity))
    if (adoptable) {
      const [from, orphan] = adoptable
      orphans.delete(from)
      loaded.set(identity.id, {
        manifest: { ...orphan, adapter: identity.id },
        origin: 'adopted',
        reset: false,
        adoptedFrom: from
      })
      continue
    }

    const previous = await readLegacy()
    if (previous) {
      const manifest = empty(identity)
      for (const [id, entry] of Object.entries(previous.documents)) {
        manifest.owners[id] = entryPaths(entry)
        manifest.records.entity[id] = { revision: entry.hash }
      }
      manifest.inputs = ['entity']
      manifest.checkpoint = checkpointOf(manifest.records)
      loaded.set(identity.id, { manifest, origin: 'migrated', reset: false })
      continue
    }

    loaded.set(identity.id, { manifest: empty(identity), origin: 'created', reset: true })
  }
  return loaded
}

/**
 * Removes the legacy single manifest once every configured instance has its
 * own, so nothing is left to mistake for current state. Until then it stays,
 * for the instances still to migrate from it.
 */
export const retireLegacyManifest = async (
  resolved: ResolvedConfig,
  configured: readonly string[],
  store: ManifestStore = projectManifestStore(resolved)
): Promise<void> => {
  const written = new Set(await store.list())
  if (configured.every((id) => written.has(id))) await rm(manifestPath(stateRootOf(resolved)), { force: true })
}
