import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../bundled/adapter-kit/dist/index.js';
/** Bumped whenever the record changes shape, so an older one is ignored rather than misread. */
const HISTORY_VERSION = 1;
export const syncHistoryPath = (resolved) => join(resolved.memoryRoot, '.cache', 'sync.json');
/** The history, or an empty one when none was kept or it cannot be read. */
export const readSyncHistory = async (resolved) => {
    try {
        const parsed = JSON.parse(await readFile(syncHistoryPath(resolved), 'utf8'));
        if (parsed.version === HISTORY_VERSION && typeof parsed.adapters === 'object' && parsed.adapters !== null) {
            return { version: HISTORY_VERSION, adapters: parsed.adapters };
        }
    }
    catch {
        // Missing or unreadable: nothing is known of earlier syncs.
    }
    return { version: HISTORY_VERSION, adapters: {} };
};
/**
 * Records `ids` as synced at `at`, keeping what is known of every other
 * instance. Best effort: the history only ever informs, so failing to write
 * it never fails a sync.
 */
export const recordSync = async (resolved, ids, at = new Date()) => {
    if (ids.length === 0)
        return;
    try {
        const history = await readSyncHistory(resolved);
        for (const id of ids)
            history.adapters[id] = { syncedAt: at.toISOString() };
        await writeFileAtomic(syncHistoryPath(resolved), `${JSON.stringify(history, null, 2)}\n`);
    }
    catch {
        // The next sync records it.
    }
};
