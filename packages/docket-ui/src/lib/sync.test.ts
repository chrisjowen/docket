import { describe, expect, it } from 'vitest'

import { ago, outOfDateHint, requestError, resultLine, runSummary, targetState } from './sync.js'
import type { UiSyncRun, UiSyncStatus } from './types.js'

const NOW = Date.parse('2026-10-26T12:00:00Z')

const run = (overrides: Partial<UiSyncRun>): UiSyncRun => ({
  id: 'run',
  state: 'succeeded',
  adapters: null,
  startedAt: '2026-10-26T11:59:00Z',
  finishedAt: '2026-10-26T11:59:30Z',
  results: [{ id: 'local', state: 'synced', projected: 3, removed: 1, unchanged: 7, failed: 0 }],
  fileErrors: 0,
  ...overrides
})

describe('sync wording', () => {
  it('says how long ago', () => {
    expect(ago('2026-10-26T11:59:40Z', NOW)).toBe('just now')
    expect(ago('2026-10-26T11:55:00Z', NOW)).toBe('5 minutes ago')
    expect(ago('2026-10-26T11:00:00Z', NOW)).toBe('1 hour ago')
    expect(ago('2026-10-23T12:00:00Z', NOW)).toBe('3 days ago')
  })

  it('hints only when a projection is behind the files or never synced', () => {
    const status: UiSyncStatus = { run: null, outOfDate: false, adapters: [{ id: 'local', state: 'current' }] }
    expect(outOfDateHint(status)).toBeNull()
    expect(
      outOfDateHint({
        run: null,
        outOfDate: true,
        adapters: [
          { id: 'local', state: 'behind', behind: 2 },
          { id: 'graph', state: 'unsynced' }
        ]
      })
    ).toBe(
      'Projections out of date: files changed since the last sync (2 changes); graph has never been synced. ' +
        'Search and Ask answer from the projections, so they may miss recent edits.'
    )
    expect(targetState({ id: 'local', state: 'behind', behind: 1 })).toBe('1 change behind')
    expect(targetState({ id: 'local', state: 'unsynced' })).toBe('not synced yet')
  })

  it('describes each adapter and the run', () => {
    expect(resultLine({ id: 'local', state: 'waiting', projected: 0, removed: 0, unchanged: 0, failed: 0 })).toBe('syncing…')
    expect(resultLine({ id: 'local', state: 'failed', projected: 2, removed: 0, unchanged: 1, failed: 1 })).toBe(
      '2 projected, 0 removed, 1 unchanged, 1 failed'
    )
    expect(runSummary(run({}), NOW)).toBe('Synced just now.')
    expect(runSummary(run({ results: [] }), NOW)).toBe('Synced just now: no adapter is enabled for projection.')
    expect(runSummary(run({ state: 'failed' }), NOW)).toBe('Sync failed just now.')
    expect(runSummary(run({ state: 'running', stage: 'projecting' }), NOW)).toBe('Projecting changes into the adapters…')
  })

  it('puts a refused request in plain words', () => {
    expect(requestError(409, { error: 'A sync is already running.' }, 'sync')).toBe('A sync is already running.')
    expect(requestError(404, null, 'sync')).toContain('older than this page')
    expect(requestError(0, null, 'sync')).toBe('Could not reach docket open to sync. Is it still running?')
    expect(requestError(500, 'oops', 'sync')).toBe('Could not sync: the server answered 500.')
  })
})
