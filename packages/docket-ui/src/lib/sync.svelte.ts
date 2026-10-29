import type { Fetcher } from './api.js'
import { requestError } from './sync.js'
import type { UiSession, UiSyncStatus } from './types.js'

/** How often a running sync is read again. */
export const POLL_MS = 500

const readBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Starting `docket sync` from the page, and following it: the latest run,
 * each projection's freshness and when it last synced. One sync runs at a
 * time - the server refuses a second - so `running` disables starting another.
 */
export class SyncState {
  status = $state.raw<UiSyncStatus | null>(null)
  /** Why the status could not be read, or a sync could not be started. */
  failure = $state<string | null>(null)
  /** Waiting for the server to accept a sync. */
  starting = $state(false)
  readonly running = $derived(this.starting || this.status?.run?.state === 'running')

  #timer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by each request, so a response to an older one is dropped. */
  #request = 0
  #finished: () => void
  #fetch: Fetcher

  /**
   * `finished` runs once a sync started here ends, so what shows the
   * projections can read them again. Requests go through `fetcher`: docket
   * open's own origin unless told otherwise.
   */
  constructor(finished: () => void = () => undefined, fetcher: Fetcher = (path, init) => fetch(path, init)) {
    this.#finished = finished
    this.#fetch = fetcher
  }

  /** Reads the status again, and keeps reading it while a sync runs. */
  async refresh(): Promise<void> {
    const request = ++this.#request
    const wasRunning = this.status?.run?.state === 'running'
    try {
      const response = await this.#fetch('/api/sync')
      const body = await readBody(response)
      if (request !== this.#request) return
      if (!response.ok) throw new Error(requestError(response.status, body, 'read the sync status'))
      this.status = body as UiSyncStatus
      if (this.failure !== null && !this.starting) this.failure = null
    } catch (cause) {
      if (request !== this.#request) return
      this.failure = cause instanceof Error ? cause.message : String(cause)
    }
    const running = this.status?.run?.state === 'running'
    if (wasRunning && !running) this.#finished()
    this.#schedule(running)
  }

  /** Starts a sync of `adapters`, every adapter enabled for projection when null. */
  async start(adapters: string[] | null): Promise<void> {
    if (this.running) return
    this.#request++
    this.starting = true
    this.failure = null
    try {
      // The token is asked for each time, so a docket open restarted since the page loaded still accepts it.
      const session = await this.#fetch('/api/session')
      const sessionBody = await readBody(session)
      if (!session.ok) throw new Error(requestError(session.status, sessionBody, 'sync'))
      const response = await this.#fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-docket-session': (sessionBody as UiSession).token },
        body: JSON.stringify(adapters === null ? {} : { adapters })
      })
      const body = await readBody(response)
      if (!response.ok) throw new Error(requestError(response.status, body, 'sync'))
      this.status = body as UiSyncStatus
    } catch (cause) {
      this.failure =
        cause instanceof TypeError ? requestError(0, null, 'sync') : cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.#request++
      this.starting = false
    }
    this.#schedule(this.status?.run?.state === 'running')
  }

  /** Stops following a running sync: the page is going away. */
  stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
  }

  #schedule(running: boolean): void {
    this.stop()
    if (running) this.#timer = setTimeout(() => void this.refresh(), POLL_MS)
  }
}
