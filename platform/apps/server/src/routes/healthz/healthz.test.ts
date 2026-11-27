// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { readyz, type ReadinessProbes } from '$lib/server/health'

import { GET } from './+server'

const up: ReadinessProbes = { kekLoaded: () => true, pingPostgres: async () => {} }
const quiet = () => {}

describe('GET /healthz', () => {
  it('answers 200 {"ok":true}', async () => {
    const response = await GET({} as Parameters<typeof GET>[0])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /readyz', () => {
  it('answers 200 when Postgres is reachable and the KEK is loaded', async () => {
    const response = await readyz(up, quiet)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, checks: { postgres: 'ok', kek: 'ok' } })
  })

  it('answers 503 without the KEK', async () => {
    const response = await readyz({ ...up, kekLoaded: () => false }, quiet)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, checks: { postgres: 'ok', kek: 'down' } })
  })

  it('answers 503 when Postgres is unreachable, without leaking the error', async () => {
    const logged: string[] = []
    const response = await readyz(
      { ...up, pingPostgres: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')) },
      (message) => logged.push(message),
    )
    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ ok: false, checks: { postgres: 'down', kek: 'ok' } })
    expect(body).not.toContain('ECONNREFUSED')
    expect(logged.join()).toContain('ECONNREFUSED')
  })
})
