import { afterEach, describe, expect, it, vi } from 'vitest'

import { SyncState } from './sync.svelte.js'
import type { UiSyncStatus } from './types.js'

const idle: UiSyncStatus = { run: null, outOfDate: true, adapters: [] }
const running: UiSyncStatus = {
  run: {
    id: 'run',
    state: 'running',
    adapters: null,
    startedAt: '2026-10-26T12:00:00Z',
    results: [],
    fileErrors: 0
  },
  outOfDate: true,
  adapters: []
}

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SyncState', () => {
  it('drops a status read that began before a sync started', async () => {
    vi.useFakeTimers()
    let answerSlowRead: (response: Response) => void = () => undefined
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/session') return Promise.resolve(json({ token: 't' }))
      if (init?.method === 'POST') return Promise.resolve(json(running))
      if (fetch.mock.calls.length === 1) return new Promise<Response>((resolve) => (answerSlowRead = resolve))
      return Promise.resolve(json(running))
    })
    vi.stubGlobal('fetch', fetch)

    const sync = new SyncState()
    const slowRead = sync.refresh()
    await sync.start(null)
    expect(sync.running).toBe(true)

    answerSlowRead(json(idle))
    await slowRead
    expect(sync.status).toEqual(running)
    expect(sync.running).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    expect(fetch.mock.calls.filter(([url, init]) => url === '/api/sync' && init?.method !== 'POST')).toHaveLength(2)
  })
})
