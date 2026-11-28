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
    expect((await post('/a/acme/d/platform/repos', 1024 * 1024 + 1)).status).toBe(413)
    expect((await post('/a/acme/d/platform/repos', 1024, { declareLength: false })).status).toBe(413)
  })

  it('lets a small body through, and a large one to the webhook', async () => {
    // Past the limit, the request reaches the runtime, which a test does not start.
    expect((await post('/a/acme/d/platform/repos', 1024 * 1024)).status).toBe(503)
    expect((await post('/api/github/webhook', 5 * 1024 * 1024)).status).toBe(503)
  })
})

function request(method: string, path: string) {
  const url = new URL(`http://localhost${path}`)
  const event = { url, request: new Request(url, { method }), route: { id: null }, locals: {}, cookies: { get: () => undefined } } as unknown as RequestEvent
  return handle({ event, resolve: async () => new Response('resolved') })
}

describe('old page addresses (/o/{org}, /o/{org}/w/{ws})', () => {
  it('redirect permanently to /a/{acct} and /a/{acct}/d/{docket}, keeping the query', async () => {
    const moved: [string, string][] = [
      ['/o/acme', '/a/acme'],
      ['/o/acme/members', '/a/acme/members'],
      ['/o/acme/ask?ws=payments', '/a/acme/ask?ws=payments'],
      ['/o/acme/s/general/new', '/a/acme/s/general/new'],
      ['/o/acme/w/payments', '/a/acme/d/payments'],
      ['/o/acme/w/payments/ask', '/a/acme/d/payments/ask'],
      ['/o/acme/w/payments/graph?focus=service.orders', '/a/acme/d/payments/graph?focus=service.orders'],
      ['/o/acme/workspaces/new/draft/d1', '/a/acme/dockets/new/draft/d1'],
    ]
    for (const [from, to] of moved) {
      const response = await request('GET', from)
      expect(response.status, from).toBe(308)
      expect(response.headers.get('location'), from).toBe(to)
    }
  })

  it('redirect a form post with 308, so it is posted again to the new address', async () => {
    const response = await request('POST', '/o/acme/members?/invite')
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/a/acme/members?/invite')
  })

  it('leave the CLI API, the org admin API and MCP addresses where they are', async () => {
    // They reach the runtime, which a test does not start.
    for (const path of ['/api/o/acme/w/payments/me', '/api/admin/o/acme/databases', '/mcp/acme', '/mcp/acme/payments', '/a/acme/d/payments/overview']) {
      expect((await request('GET', path)).status, path).toBe(503)
    }
  })
})
