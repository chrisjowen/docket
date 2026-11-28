// SPDX-License-Identifier: AGPL-3.0-only
import { isHttpError, type RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessRows } from '$lib/server/testing-access'

type Query = { sql: string; params: unknown[] }

const queries: Query[] = []
let role: string | null = 'viewer'
let cogneeOn = false

async function transaction<T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>) {
  return fn({
    async query(sql, params = []) {
      queries.push({ sql, params })
      const access = accessRows(sql, role)
      if (access) return { rows: access, rowCount: access.length }
      if (sql.includes('FROM workspaces WHERE')) return { rows: [{ id: 'wsmain', slug: 'main', name: 'Main', created_by: 'user:u1', created_at: new Date() }], rowCount: 1 }
      if (sql.includes('FROM projection_status')) {
        const row = { failures: 2, last_error: 'pod asleep', attempted_at: new Date(), synced_at: null, retry_at: null }
        return { rows: [{ ...row, instance_id: 'neo4j' }, { ...row, instance_id: 'mem0' }], rowCount: 2 }
      }
      if (sql.includes('FROM cognee_settings')) return cogneeOn ? { rows: [{ enabled: true }], rowCount: 1 } : { rows: [], rowCount: 0 }
      if (sql.includes('FROM outbox')) return { rows: [{ pending: '3', oldest_at: new Date(), recheck: true, changed_at: new Date() }], rowCount: 1 }
      if (sql.includes('FROM sync_runs')) {
        const at = new Date()
        return { rows: [{ id: '7', workspace_id: 'wsmain', started_at: at, finished_at: at, triggers: ['recheck'], ok: false, instances: [] }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  })
}

const runtime = {
  router: { withPlatform: transaction, withTenant: (_org: string, fn: Parameters<typeof transaction>[0]) => transaction(fn) },
  keyring: { forOrg: async () => ({}) },
}
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))

const validate = vi.fn()
vi.mock('@docket/platform-canonical-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@docket/platform-canonical-store')>()
  return { ...actual, validate: (...args: Parameters<typeof actual.validate>) => (validate(...args), actual.validate(...args)) }
})

const authorise = vi.fn()
vi.mock('$lib/server/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/request')>()
  return { ...actual, authorise: (...args: Parameters<typeof actual.authorise>) => (authorise(args[1]), actual.authorise(...args)) }
})

const { GET } = await import('./+server')

const event = (signedIn = true) =>
  ({
    params: { org: 'acme', ws: 'main' },
    locals: { user: signedIn ? { id: 'u1', login: 'vera' } : null, startedAt: performance.now(), requestId: 'req1' },
    url: new URL('https://docket.example/a/acme/d/main/settings/sync/status'),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as RequestEvent

const refusal = (event: RequestEvent) => Promise.resolve(GET(event as never)).catch((thrown: unknown) => (isHttpError(thrown) ? thrown.status : thrown))

describe('the Sync page’s standing, read again while it is open', () => {
  beforeEach(() => {
    queries.length = 0
    validate.mockClear()
    authorise.mockClear()
    role = 'viewer'
    cogneeOn = false
  })

  it('answers any member, under Read and ask, with each store’s standing from the worker’s bookkeeping, opening no document and leaving the lag to the page load', async () => {
    const response = await GET(event() as never)
    expect(response.status).toBe(200)
    expect(authorise).toHaveBeenCalledWith('read')
    const body = (await response.json()) as { outbox: unknown; stores: Record<string, unknown>[]; runs: { id: string; triggers: string[] }[] }
    expect(body.outbox).toMatchObject({ pending: 3, recheckPending: true })
    expect(body.stores).toEqual([
      expect.objectContaining({ id: 'neo4j', failures: 2, error: 'pod asleep', syncedAt: null }),
      expect.objectContaining({ id: 'mem0', failures: 2, error: 'pod asleep', syncedAt: null }),
    ])
    for (const store of body.stores) expect(store).not.toHaveProperty('behind')
    expect(body.runs).toMatchObject([{ id: '7', triggers: ['recheck'] }])
    expect(validate).not.toHaveBeenCalled()
    expect(queries.some((q) => /FROM documents|raw_ciphertext|FROM document_revisions|FROM ingest/.test(q.sql))).toBe(false)
    expect(queries.some((q) => /^\s*(UPDATE|INSERT|DELETE)/i.test(q.sql))).toBe(false)
  })

  it('shows cognee after the fixed stores, marked optional, only while the workspace has it on', async () => {
    const off = (await (await GET(event() as never)).json()) as { stores: { id: string; optional: boolean }[] }
    expect(off.stores.map((store) => [store.id, store.optional])).toEqual([
      ['neo4j', false],
      ['mem0', false],
    ])
    cogneeOn = true
    const on = (await (await GET(event() as never)).json()) as { stores: { id: string; optional: boolean; failures: number }[] }
    expect(on.stores.map((store) => [store.id, store.optional])).toEqual([
      ['neo4j', false],
      ['mem0', false],
      ['cognee', true],
    ])
  })

  it('answers nobody outside the org, and asks a signed-out caller to sign in', async () => {
    role = null
    expect(await refusal(event())).toBe(404)
    expect(await refusal(event(false))).toBe(401)
    expect(validate).not.toHaveBeenCalled()
  })
})
