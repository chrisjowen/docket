import { open, readFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const MANIFEST_FILENAME = 'manifest.json'
export const MANIFEST_VERSION = 1

/** What `sync` needs to decide a document is unchanged. */
export interface ManifestEntry {
  /** Repo-relative path of the source file, as of the last projection. */
  path: string
  /** `sha256:<hex>` of the file contents that produced the current records. */
  hash: string
}

/** Maps stable identity to path and last projected hash (spec §31). */
export interface IndexManifest {
  version: number
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
    return { version: MANIFEST_VERSION, documents }
  } catch {
    return emptyManifest()
  }
}

/** Written with sorted ids so identical inputs produce identical bytes (spec §72). */
export async function writeManifest(outputDir: string, manifest: IndexManifest): Promise<void> {
  const documents: Record<string, ManifestEntry> = {}
  for (const id of Object.keys(manifest.documents).sort()) {
    const entry = manifest.documents[id]
    if (entry) documents[id] = { hash: entry.hash, path: entry.path }
  }

  const serialized = JSON.stringify({ documents, version: manifest.version }, null, 2)
  await writeFileAtomic(manifestPath(outputDir), `${serialized}\n`)
}

/**
 * Temp file + rename, because rename is atomic on the same filesystem: a crash
 * mid-write leaves the previous index intact rather than a half-written one
 * (spec §68). Lives here as the lowest-level index writer; the projections
 * depend on the manifest, never the other way round.
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}
