import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiAt } from './api.js'

afterEach(() => vi.unstubAllGlobals())

describe('apiAt', () => {
  it('asks the page’s own origin by default, and the viewer’s address when given one', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await apiAt().fetch('/api/graph')
    await apiAt('http://127.0.0.1:4400/').fetch('/api/sync', { method: 'POST' })
    expect(fetch.mock.calls).toEqual([
      ['/api/graph', undefined],
      ['http://127.0.0.1:4400/api/sync', { method: 'POST' }]
    ])
    expect(apiAt('http://127.0.0.1:4400//').base).toBe('http://127.0.0.1:4400')
  })
})
