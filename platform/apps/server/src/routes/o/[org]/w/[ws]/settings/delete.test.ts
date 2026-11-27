// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect, type RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessRows } from '$lib/server/testing-access'

type Query = { sql: string; params: unknown[] }

/** What each database holds once its transactions commit; a transaction whose callback throws rolls back. */
const committed: { org: Query[]; platform: Query[] } = { org: [], platform: [] }
let platformDown = false

function transaction(db: 'org' | 'platform') {
  return async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>) => {
    const pending: Query[] = []
    const result = await fn({
      async query(sql, params = []) {
        pending.push({ sql, params })
        if (db === 'platform' && platformDown && sql.includes('oauth_store')) throw new Error('pool timeout')
        const access = accessRows(sql, 'owner')
        if (access) return { rows: access, rowCount: access.length }
        if (sql.includes('FROM workspaces WHERE')) return { rows: [{ id: 'wsmain', slug: 'main', name: 'Main', created_by: 'user:u1', created_at: new Date() }], rowCount: 1 }
        if (sql.includes('FROM repo_connections')) return { rows: [{ id: 'conn1' }], rowCount: 1 }
        if (sql.includes('FROM audit_head')) return { rows: [{ hash: '0'.repeat(64) }], rowCount: 1 }
        if (sql.includes('SELECT DISTINCT grant_id')) return { rows: [{ grant_id: 'grant1' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    })
    committed[db].push(...pending)
    return result
  }
}

const runtime = {
  origin: 'https://docket.example',
  router: { withPlatform: transaction('platform'), withTenant: (_org: string, fn: Parameters<ReturnType<typeof transaction>>[0]) => transaction('org')(fn) },
  keyring: { forOrg: async () => ({}) },
}
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))

const { actions } = await import('./+page.server')

function event(): RequestEvent {
  const body = new FormData()
  body.set('confirm', 'main')
  return {
    params: { org: 'acme', ws: 'main' },
    locals: { user: { id: 'u1', login: 'alice' }, startedAt: performance.now(), requestId: 'req1' },
    request: new Request('https://docket.example/o/acme/w/main/settings?/delete', { method: 'POST', body }),
    url: new URL('https://docket.example/o/acme/w/main/settings?/delete'),
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent
}

const deletedWorkspace = () => committed.org.some((q) => q.sql.startsWith('DELETE FROM workspaces'))
const revokedGrants = () => committed.platform.some((q) => q.sql.startsWith('DELETE FROM platform.oauth_store'))
const droppedRoutes = () => committed.platform.some((q) => q.sql.startsWith('DELETE FROM platform.repo_routes'))

describe('deleting a workspace', () => {
  beforeEach(() => {
    committed.org = []
    committed.platform = []
    platformDown = false
  })

  it('revokes its OAuth grants and drops its webhook routes along with the delete', async () => {
    const thrown = await Promise.resolve(actions.delete!(event() as never)).catch((error: unknown) => error)
    expect(isRedirect(thrown) && thrown.location).toBe('/o/acme?deleted=main')
    expect(deletedWorkspace()).toBe(true)
    expect(revokedGrants()).toBe(true)
    expect(droppedRoutes()).toBe(true)
  })

  it('keeps the workspace when its credentials cannot be revoked, so no grant outlives it', async () => {
    platformDown = true
    await expect(actions.delete!(event() as never)).rejects.toThrow('pool timeout')
    expect(deletedWorkspace()).toBe(false)
    expect(revokedGrants()).toBe(false)
  })
})
