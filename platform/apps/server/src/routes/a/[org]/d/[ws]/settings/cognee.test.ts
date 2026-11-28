// SPDX-License-Identifier: AGPL-3.0-only
import { isActionFailure, isHttpError, type RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessRows } from '$lib/server/testing-access'

type Query = { sql: string; params: unknown[] }

const committed: Query[] = []
let role = 'admin'

function transaction() {
  return async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>) => {
    const pending: Query[] = []
    const result = await fn({
      async query(sql, params = []) {
        pending.push({ sql, params })
        const access = accessRows(sql, role)
        if (access) return { rows: access, rowCount: access.length }
        if (sql.includes('FROM workspaces WHERE')) return { rows: [{ id: 'wsmain', slug: 'main', name: 'Main', created_by: 'user:u1', created_at: new Date() }], rowCount: 1 }
        if (sql.includes('FROM audit_head')) return { rows: [{ hash: '0'.repeat(64) }], rowCount: 1 }
        if (sql.includes('INSERT INTO cognee_settings')) {
          const [workspace_id, enabled, floor, monthly_limit_usd] = params as [string, boolean, number, number]
          return { rows: [{ workspace_id, enabled, floor: String(floor), monthly_limit_usd: String(monthly_limit_usd), projected_through: null, updated_by: 'user:u1', updated_at: new Date() }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
    })
    committed.push(...pending)
    return result
  }
}

const runtime = {
  origin: 'https://docket.example',
  cognee: true,
  router: { withPlatform: transaction(), withTenant: (_org: string, fn: Parameters<ReturnType<typeof transaction>>[0]) => transaction()(fn) },
  keyring: { forOrg: async () => ({}) },
  caps: { status: async () => ({ capUsd: 20 }) },
}
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))

const { actions } = await import('./+page.server')

function event(fields: Record<string, string>): RequestEvent {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.set(name, value)
  return {
    params: { org: 'acme', ws: 'main' },
    locals: { user: { id: 'u1', login: 'alice' }, startedAt: performance.now(), requestId: 'req1' },
    request: new Request('https://docket.example/a/acme/d/main/settings?/cognee', { method: 'POST', body }),
    url: new URL('https://docket.example/a/acme/d/main/settings?/cognee'),
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent
}

const run = (fields: Record<string, string>) => Promise.resolve(actions.cognee!(event(fields) as never)).catch((thrown: unknown) => thrown)
const saved = () => committed.find((q) => q.sql.includes('INSERT INTO cognee_settings'))

describe("turning a workspace's cognee on or off", () => {
  beforeEach(() => {
    committed.length = 0
    role = 'admin'
    runtime.cognee = true
  })

  it('lets an owner or admin turn it on with a floor and limit, asks the worker for a pass, and audits it', async () => {
    const result = await run({ enabled: 'on', floor: '0.58', limit: '2' })
    expect(result).toMatchObject({ cogneeFlash: expect.stringContaining('On:') })
    expect(saved()?.params.slice(0, 4)).toEqual(['wsmain', true, 0.58, 2])
    expect(committed.some((q) => q.sql.startsWith('INSERT INTO outbox') && q.params.includes('recheck'))).toBe(true)
    expect(committed.some((q) => q.sql.includes('audit') && JSON.stringify(q.params).includes('cognee.settings'))).toBe(true)
  })

  it('refuses an editor: changing it is for a role that may change settings', async () => {
    role = 'editor'
    const thrown = await run({ enabled: 'on', floor: '0.58', limit: '2' })
    expect(isHttpError(thrown) && thrown.status).toBe(403)
    expect(saved()).toBeUndefined()
  })

  it('refuses to turn it on where no cognee service runs, and a floor outside 0 to 1', async () => {
    runtime.cognee = false
    const unavailable = await run({ enabled: 'on', floor: '0.58', limit: '2' })
    expect(isActionFailure(unavailable) && unavailable.data).toEqual({ cogneeProblem: expect.stringContaining('does not run on this server') })
    runtime.cognee = true
    const badFloor = await run({ enabled: 'on', floor: '1.5', limit: '2' })
    expect(isActionFailure(badFloor) && badFloor.data).toEqual({ cogneeProblem: expect.stringContaining('between 0 and 1') })
    expect(saved()).toBeUndefined()
  })

  it('turns it off even where no cognee service runs', async () => {
    runtime.cognee = false
    expect(await run({ floor: '0.58', limit: '2' })).toMatchObject({ cogneeFlash: expect.stringContaining('Off:') })
    expect(saved()?.params[1]).toBe(false)
  })
})
