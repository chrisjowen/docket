import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeFileAtomic } from '@docket/adapter-kit'

export const MANIFEST_FILENAME = 'manifest.json'
export const MANIFEST_VERSION = 1

/** What `sync` needs to decide an entity is unchanged. */
export interface ManifestEntry {
  /** Repo-relative path of the entity's first source file, as of the last projection. */
  path: string
  /** Every source file, when more than one declares the id. */
  paths?: string[]
  /** `sha256:<hex>` of the merged entity that produced the current records. */
  hash: string
}

/** Every file an entry was projected from. */
export const entryPaths = (entry: ManifestEntry): string[] => entry.paths ?? [entry.path]

/**
 * Maps stable identity to path and last projected hash (spec §31). Before
 * each adapter instance kept its own manifest (`adapter-manifest.ts`), sync
 * kept this one for every projection together; it is now read only to
 * migrate from, and the watcher keeps its own record of what it read in
 * this shape.
 */
export interface IndexManifest {
  version: number
  /**
   * Fingerprint of the projection config these entries were projected into.
   * A manifest written for a different set says nothing about what a newly
   * added projection holds, so it must not gate anything.
   */
  projections?: string
  documents: Record<string, ManifestEntry>
}

export function emptyManifest(): IndexManifest {
  return { version: MANIFEST_VERSION, documents: {} }
}

export function manifestPath(outputDir: string): string {
  return join(outputDir, MANIFEST_FILENAME)
}

/**
 * The manifest is derived state, so an absent or unreadable one is not an
 * error - it just means nothing is known and everything must be reprojected.
 */
export async function readManifest(outputDir: string): Promise<IndexManifest> {
  let raw: string
  try {
    raw = await readFile(manifestPath(outputDir), 'utf8')
  } catch {
    return emptyManifest()
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return emptyManifest()
    const documents = (parsed as IndexManifest).documents
    if (documents === null || typeof documents !== 'object') return emptyManifest()
    const projections = (parsed as IndexManifest).projections
    return {
      version: MANIFEST_VERSION,
      ...(typeof projections === 'string' ? { projections } : {}),
      documents
    }
  } catch {
    return emptyManifest()
  }
}

/** Written with sorted ids so identical inputs produce identical bytes (spec §72). */
export async function writeManifest(outputDir: string, manifest: IndexManifest): Promise<void> {
  const documents: Record<string, ManifestEntry> = {}
  for (const id of Object.keys(manifest.documents).sort()) {
    const entry = manifest.documents[id]
    if (entry) documents[id] = { hash: entry.hash, path: entry.path, paths: entry.paths }
  }

  const serialized = JSON.stringify(
    { documents, projections: manifest.projections, version: manifest.version },
    null,
    2
  )
  await writeFileAtomic(manifestPath(outputDir), `${serialized}\n`)
}
