import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../bundled/adapter-kit/dist/index.js';
export const MANIFEST_FILENAME = 'manifest.json';
export const MANIFEST_VERSION = 1;
/** Every file an entry was projected from. */
export const entryPaths = (entry) => entry.paths ?? [entry.path];
export function emptyManifest() {
    return { version: MANIFEST_VERSION, documents: {} };
}
export function manifestPath(outputDir) {
    return join(outputDir, MANIFEST_FILENAME);
}
/**
 * The manifest is derived state, so an absent or unreadable one is not an
 * error - it just means nothing is known and everything must be reprojected.
 */
export async function readManifest(outputDir) {
    let raw;
    try {
        raw = await readFile(manifestPath(outputDir), 'utf8');
    }
    catch {
        return emptyManifest();
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object')
            return emptyManifest();
        const documents = parsed.documents;
        if (documents === null || typeof documents !== 'object')
            return emptyManifest();
        const projections = parsed.projections;
        return {
            version: MANIFEST_VERSION,
            ...(typeof projections === 'string' ? { projections } : {}),
            documents
        };
    }
    catch {
        return emptyManifest();
    }
}
/** Written with sorted ids so identical inputs produce identical bytes (spec §72). */
export async function writeManifest(outputDir, manifest) {
    const documents = {};
    for (const id of Object.keys(manifest.documents).sort()) {
        const entry = manifest.documents[id];
        if (entry)
            documents[id] = { hash: entry.hash, path: entry.path, paths: entry.paths };
    }
    const serialized = JSON.stringify({ documents, projections: manifest.projections, version: manifest.version }, null, 2);
    await writeFileAtomic(manifestPath(outputDir), `${serialized}\n`);
}
