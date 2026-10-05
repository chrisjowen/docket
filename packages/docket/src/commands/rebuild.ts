import { reconcile, type SyncOptions, type SyncResult } from './sync.js'

export type RebuildOptions = SyncOptions
export type RebuildResult = SyncResult

/**
 * Reset every projection and project every canonical document (spec §39).
 * Logically `rm -rf .docket/.index && docket sync`, but routed through the
 * projection interface so non-file projections are dropped too.
 */
export const rebuild = (options: RebuildOptions = {}): Promise<RebuildResult> =>
  reconcile({ ...options, fresh: true })
