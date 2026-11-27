// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { healthServer, type Pingable } from './health.js'

describe('the worker probe port', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  async function serve(pool: Pingable): Promise<string> {
    const server = healthServer(pool)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    close = () => new Promise<void>((resolve) => server.close(() => resolve()))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  const up: Pingable = { query: async () => ({ rows: [] }) }

  it('answers /healthz, and /readyz while Postgres answers', async () => {
    const base = await serve(up)
    const health = await fetch(`${base}/healthz`)
    expect([health.status, await health.text()]).toEqual([200, 'ok'])
    const ready = await fetch(`${base}/readyz`)
    expect([ready.status, await ready.text()]).toEqual([200, 'ready'])
  })

  it('is not ready while Postgres is down', async () => {
    const base = await serve({ query: async () => Promise.reject(new Error('connection refused')) })
    const ready = await fetch(`${base}/readyz`)
    expect([ready.status, await ready.text()]).toEqual([503, 'postgres: connection refused'])
  })

  it('has no ask route: a question with the tenant in the body is not answered (§3)', async () => {
    const base = await serve(up)
    const asked = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-a', workspaceId: 'ws-a', question: 'who owns the ledger?', actor: 'user:x' }),
    })
    expect(asked.status).toBe(404)
    expect(await asked.text()).toBe('')
  })
})
