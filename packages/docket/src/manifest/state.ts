import { stateRootOf, type ResolvedConfig } from '../config/config.js'
import { emptyManifest, readManifest, writeManifest, type IndexManifest } from './manifest.js'

export interface ManifestState {
  manifest: IndexManifest
  /**
   * The manifest was written for different projections, or never written.
   * Its hashes cannot vouch for what the current projections hold, so the
   * caller must reset them and project everything.
   */
  stale: boolean
}

/**
 * The manifest belongs to sync, not to any one projection, so any set of
 * projections - jsonl, mem0, both - shares one hash gate (spec §24, §31).
 * `projections` is the docket's `projectionsFingerprint`: a manifest written
 * under another one vouches for nothing.
 */
export const loadManifestState = async (resolved: ResolvedConfig, projections: string): Promise<ManifestState> => {
  const manifest = await readManifest(stateRootOf(resolved))
  if (manifest.projections === projections) {
    return { manifest, stale: false }
  }
  return { manifest: emptyManifest(), stale: true }
}

export const saveManifest = (
  resolved: ResolvedConfig,
  projections: string,
  documents: IndexManifest['documents']
): Promise<void> =>
  writeManifest(stateRootOf(resolved), {
    ...emptyManifest(),
    projections,
    documents
  })
