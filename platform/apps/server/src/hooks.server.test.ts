// SPDX-License-Identifier: AGPL-3.0-only
import type { RequestEvent } from '@sveltejs/kit'
import { describe, expect, it } from 'vitest'

import { handle } from './hooks.server'

function post(path: string, size: number, options: { declareLength?: boolean } = {}) {
  const url = new URL(`http://localhost${path}`)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.declareLength ?? true) headers.set('content-length', String(size))
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })
  const request = new Request(url, { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
  const event = { url, request, route: { id: null }, locals: {}, cookies: { get: () => undefined } } as unknown as RequestEvent
  return handle({ event, resolve: async () => new Response('resolved') })
}

describe('request body limit', () => {
  it('refuses a body over 1 MB on any route but the GitHub webhook', async () => {
    expect((await post('/o/acme/w/platform/repos', 1024 * 1024 + 1)).status).toBe(413)
    expect((await post('/o/acme/w/platform/repos', 1024, { declareLength: false })).status).toBe(413)
  })

  it('lets a small body through, and a large one to the webhook', async () => {
    // Past the limit, the request reaches the runtime, which a test does not start.
    expect((await post('/o/acme/w/platform/repos', 1024 * 1024)).status).toBe(503)
    expect((await post('/api/github/webhook', 5 * 1024 * 1024)).status).toBe(503)
  })
})
