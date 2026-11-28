// SPDX-License-Identifier: AGPL-3.0-only
import type { RequestEvent } from '@sveltejs/kit'
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
      return { rows: [], rowCount: 0 }
    },
  })
}

const runtime = {
  router: { withPlatform: transaction, withTenant: (_org: string, fn: Parameters<typeof transaction>[0]) => transaction(fn) },
  keyring: { forOrg: async () => ({}) },
}
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))

const { load } = await import('./+page.server')

const event = () =>
  ({
    params: { org: 'acme', ws: 'main' },
    locals: { user: { id: 'u1', login: 'alice' }, startedAt: performance.now(), requestId: 'req1' },
    url: new URL('https://docket.example/a/acme/d/main/settings/queries'),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as RequestEvent

/** The member the traces were read for: null when everyone's were. */
const askedBy = () => queries.find((q) => q.sql.includes('FROM query_traces'))?.params[2]

describe('whose questions Settings → Queries reads', () => {
  beforeEach(() => {
    queries.length = 0
  })

  for (const everyone of ['owner', 'admin']) {
    it(`reads everyone's for an ${everyone}`, async () => {
      role = everyone
      expect(await load(event() as never)).toMatchObject({ everyone: true })
      expect(askedBy()).toBeNull()
    })
  }

  for (const own of ['editor', 'viewer']) {
    it(`reads only their own for an ${own}`, async () => {
      role = own
      expect(await load(event() as never)).toMatchObject({ everyone: false })
      expect(askedBy()).toBe('u1')
    })
  }
})
