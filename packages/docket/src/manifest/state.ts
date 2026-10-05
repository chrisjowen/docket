import { stateRootOf, type ResolvedConfig } from '../config/config.js'
import { stableStringify } from '../model/stable-json.js'
import { hashContent } from '../source/hashing.js'
import { emptyManifest, readManifest, writeManifest, type IndexManifest } from './manifest.js'

/** Changes whenever a projection is added, removed or reconfigured. */
export const projectionsFingerprint = (resolved: ResolvedConfig): string =>
  hashContent(stableStringify(resolved.config.projections))

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
 */
export const loadManifestState = async (resolved: ResolvedConfig): Promise<ManifestState> => {
  const manifest = await readManifest(stateRootOf(resolved))
  if (manifest.projections === projectionsFingerprint(resolved)) {
    return { manifest, stale: false }
  }
  return { manifest: emptyManifest(), stale: true }
}

export const saveManifest = (
  resolved: ResolvedConfig,
  documents: IndexManifest['documents']
): Promise<void> =>
  writeManifest(stateRootOf(resolved), {
    ...emptyManifest(),
    projections: projectionsFingerprint(resolved),
    documents
  })
