import type { UiSyncAdapterResult, UiSyncRun, UiSyncStage, UiSyncStatus, UiSyncTarget } from './types.js'

/*
 * Words for a sync started from the page: how long ago, how far behind, what
 * each adapter did. Kept apart from the component so they can be tested.
 */

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** "just now", "5 minutes ago", "3 days ago". */
export const ago = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (Number.isNaN(seconds)) return 'at an unknown time'
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  return `${plural(Math.round(hours / 24), 'day')} ago`
}

export const STAGES: Record<UiSyncStage, string> = {
  validating: 'Reading and checking the files…',
  projecting: 'Projecting changes into the adapters…',
  recording: 'Recording what each adapter holds…'
}

/** How one projection stands against the files. */
export const targetState = (target: UiSyncTarget): string => {
  switch (target.state) {
    case 'current':
      return 'up to date'
    case 'behind':
      return target.behind === undefined ? 'behind the files' : `${plural(target.behind, 'change')} behind`
    case 'unsynced':
      return 'not synced yet'
    default:
      return 'freshness unknown'
  }
}

/** The out-of-date hint, or null when every projection holds the files as they are. */
export const outOfDateHint = (status: UiSyncStatus): string | null => {
  if (!status.outOfDate) return null
  const behind = status.adapters.filter((target) => target.state === 'behind')
  const unsynced = status.adapters.filter((target) => target.state === 'unsynced')
  const changes = Math.max(0, ...behind.map((target) => target.behind ?? 0))
  const parts = [
    ...(behind.length > 0 ? [`files changed since the last sync (${plural(changes, 'change')})`] : []),
    ...(unsynced.length > 0 ? [`${unsynced.map((target) => target.id).join(', ')} ${unsynced.length === 1 ? 'has' : 'have'} never been synced`] : [])
  ]
  return `Projections out of date: ${parts.join('; ')}. Search and Ask answer from the projections, so they may miss recent edits.`
}

/** What one adapter did, in a line. */
export const resultLine = (result: UiSyncAdapterResult): string => {
  if (result.state === 'waiting') return 'syncing…'
  const counts = `${result.projected} projected, ${result.removed} removed, ${result.unchanged} unchanged`
  return result.failed > 0 ? `${counts}, ${result.failed} failed` : counts
}

/** The run's outcome, in a sentence. */
export const runSummary = (run: UiSyncRun, now: number = Date.now()): string => {
  if (run.state === 'running') return run.stage ? STAGES[run.stage] : 'Syncing…'
  const when = run.finishedAt ? ` ${ago(run.finishedAt, now)}` : ''
  if (run.state === 'succeeded') {
    return run.results.length === 0 ? `Synced${when}: no adapter is enabled for projection.` : `Synced${when}.`
  }
  return `Sync failed${when}.`
}

/** A refused or failed request, in plain words. */
export const requestError = (status: number, body: unknown, what: string): string => {
  const error = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : undefined
  if (status === 404 || status === 405) return `This docket open cannot ${what}: it is older than this page. Restart it with the current docket.`
  if (error !== undefined) return error
  if (status === 0) return `Could not reach docket open to ${what}. Is it still running?`
  return `Could not ${what}: the server answered ${status}.`
}
