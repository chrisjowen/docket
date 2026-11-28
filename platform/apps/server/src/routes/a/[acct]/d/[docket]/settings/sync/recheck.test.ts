// SPDX-License-Identifier: AGPL-3.0-only
import { isHttpError, type RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessRows } from '$lib/server/testing-access'

type Query = { sql: string; params: unknown[] }

const queries: Query[] = []
let role = 'owner'

async function transaction<T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>) {
  return fn({
    async query(sql, params = []) {
      queries.push({ sql, params })
      const access = accessRows(sql, role)
      if (access) return { rows: access, rowCount: access.length }
      if (sql.includes('FROM workspaces WHERE')) return { rows: [{ id: 'wsmain', slug: 'main', name: 'Main', created_by: 'user:u1', created_at: new Date() }], rowCount: 1 }
      if (sql.includes('FROM audit_head')) return { rows: [{ hash: '0'.repeat(64) }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  })
}

const runtime = {
  router: { withPlatform: transaction, withTenant: (_org: string, fn: Parameters<typeof transaction>[0]) => transaction(fn) },
  keyring: { forOrg: async () => ({}) },
}
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))

const { actions } = await import('./+page.server')

const event = () =>
  ({
    params: { acct: 'acme', docket: 'main' },
    locals: { user: { id: 'u1', login: 'alice' }, startedAt: performance.now(), requestId: 'req1' },
    request: new Request('https://docket.example/a/acme/d/main/settings/sync?/recheck', { method: 'POST' }),
    url: new URL('https://docket.example/a/acme/d/main/settings/sync?/recheck'),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as RequestEvent

const queued = () => queries.some((q) => q.sql.startsWith('INSERT INTO outbox') && q.params.includes('recheck'))

describe('re-checking the stores', () => {
  beforeEach(() => {
    queries.length = 0
  })

  it('queues a pass past the backoff for an owner, with its audit event', async () => {
    role = 'owner'
    expect(await actions.recheck!(event() as never)).toMatchObject({ flash: expect.stringContaining('Re-check requested') })
    expect(queued()).toBe(true)
    expect(queries.some((q) => q.sql.startsWith('UPDATE projection_status SET retry_at = NULL'))).toBe(true)
    expect(queries.some((q) => q.sql.includes('audit') && JSON.stringify(q.params).includes('projections.recheck'))).toBe(true)
  })

  for (const other of ['admin', 'editor', 'viewer']) {
    it(`refuses an ${other}, and queues nothing`, async () => {
      role = other
      const thrown = await Promise.resolve(actions.recheck!(event() as never)).catch((error: unknown) => error)
      expect(isHttpError(thrown) && thrown.status).toBe(403)
      expect(queued()).toBe(false)
    })
  }
})
