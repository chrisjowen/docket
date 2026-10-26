import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeFileAtomic } from '@docket/adapter-kit'

import type { ResolvedConfig } from '../config/config.js'

/** Bumped whenever the record changes shape, so an older one is ignored rather than misread. */
const HISTORY_VERSION = 1

/**
 * When each adapter instance last synced in full, kept in the docket's
 * disposable `.cache/` - never beside the manifests, which hold no time so a
 * rebuild reproduces them byte for byte.
 */
export interface SyncHistory {
  version: typeof HISTORY_VERSION
  /** By instance id: when its last sync finished with nothing failed. */
  adapters: Record<string, { syncedAt: string }>
}

export const syncHistoryPath = (resolved: Pick<ResolvedConfig, 'memoryRoot'>): string =>
  join(resolved.memoryRoot, '.cache', 'sync.json')

/** The history, or an empty one when none was kept or it cannot be read. */
export const readSyncHistory = async (resolved: Pick<ResolvedConfig, 'memoryRoot'>): Promise<SyncHistory> => {
  try {
    const parsed = JSON.parse(await readFile(syncHistoryPath(resolved), 'utf8')) as Partial<SyncHistory>
    if (parsed.version === HISTORY_VERSION && typeof parsed.adapters === 'object' && parsed.adapters !== null) {
      return { version: HISTORY_VERSION, adapters: parsed.adapters }
    }
  } catch {
    // Missing or unreadable: nothing is known of earlier syncs.
  }
  return { version: HISTORY_VERSION, adapters: {} }
}

/**
 * Records `ids` as synced at `at`, keeping what is known of every other
 * instance. Best effort: the history only ever informs, so failing to write
 * it never fails a sync.
 */
export const recordSync = async (
  resolved: Pick<ResolvedConfig, 'memoryRoot'>,
  ids: readonly string[],
  at: Date = new Date()
): Promise<void> => {
  if (ids.length === 0) return
  try {
    const history = await readSyncHistory(resolved)
    for (const id of ids) history.adapters[id] = { syncedAt: at.toISOString() }
    await writeFileAtomic(syncHistoryPath(resolved), `${JSON.stringify(history, null, 2)}\n`)
  } catch {
    // The next sync records it.
  }
}
