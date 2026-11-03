import {
  listAdapterManifests,
  readAdapterManifest,
  removeAdapterManifest,
  writeAdapterManifest,
  type AdapterManifest
} from './adapter-manifest.js'

/**
 * Where each adapter instance's sync manifest lives (docs/adapter-spec.md
 * §8): files under the state root today, a database row in Docket Cloud.
 * Sync reads and writes manifests only through it.
 */
export interface ManifestStore {
  /** The instance's manifest; `undefined` when there is none, or none this version of docket can read. */
  read(instanceId: string): Promise<AdapterManifest | undefined>
  /** Replaces the instance's manifest. */
  write(instanceId: string, manifest: AdapterManifest): Promise<void>
  /** Every instance id a manifest is held for, sorted: what an orphan, left by a renamed instance, is found among. */
  list(): Promise<string[]>
  /** Forgets the instance's manifest, if it has one. */
  remove(instanceId: string): Promise<void>
}

/** The manifests as files: `<state root>/manifests/<instance id>.json`, in the bytes sync has always written. */
export const fileManifestStore = (stateRoot: string): ManifestStore => ({
  read: (instanceId) => readAdapterManifest(stateRoot, instanceId),
  write: (instanceId, manifest) => writeAdapterManifest(stateRoot, { ...manifest, adapter: instanceId }),
  list: () => listAdapterManifests(stateRoot),
  remove: (instanceId) => removeAdapterManifest(stateRoot, instanceId)
})
