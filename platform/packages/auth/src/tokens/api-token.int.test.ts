// SPDX-License-Identifier: AGPL-3.0-only
import { tenantRouter, type TenantRouter, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiTokenError, issueApiToken, newApiToken, tokenHash } from './api-token.js'
import { tokenResolver } from './lookup.js'

describe.skipIf(!TEST_PG_URL)('API tokens in Postgres', () => {
  let db: TestDatabase
  let router: TenantRouter
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-ed', 'human', 1, 'ed'), ('u-vi', 'human', 2, 'vi');
      INSERT INTO platform.orgs (id, slug, name, status, created_by) VALUES ('orga', 'acme', 'Acme', 'active', 'u-ed');
      INSERT INTO platform.memberships (org_id, user_id, role) VALUES ('orga', 'u-ed', 'editor'), ('orga', 'u-vi', 'viewer');
      INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES
        ('orga', 'ws1', 'u-ed', 'write'), ('orga', 'ws1', 'u-vi', 'read');
    `)
  }, 60_000)

  afterAll(async () => {
    await db?.drop()
  })

  const issue = (ownerId: string, scopes: string[], extra: { expiresInDays?: number; ontologyWriters?: ('owner' | 'admin' | 'editor')[] } = {}) =>
    platform((tx) => issueApiToken(tx, { orgId: 'orga', workspaceId: 'ws1', ownerId, createdBy: ownerId, scopes, ...extra }))

  it('stores only the SHA-256 of the token', async () => {
    const { token, id } = await issue('u-ed', ['docket:read'])
    const { rows } = await db.superuser.query('SELECT * FROM platform.api_tokens WHERE id = $1', [id])
    const row = rows[0] as Record<string, unknown>
    expect(row.token_hash).toBe(tokenHash(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(token.slice(17, 40))
    expect(row.prefix).toBe(token.slice(0, 17))
  })

  it('requires an expiry of at most 90 days, 30 by default', async () => {
    const { expiresAt } = await issue('u-ed', ['docket:read'])
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(30)
    await expect(issue('u-ed', ['docket:read'], { expiresInDays: 91 })).rejects.toBeInstanceOf(ApiTokenError)
    await expect(issue('u-ed', ['docket:read'], { expiresInDays: 0 })).rejects.toBeInstanceOf(ApiTokenError)
  })

  it("keeps a viewer's tokens read-only", async () => {
    await expect(issue('u-vi', ['docket:write'])).rejects.toThrow(/token with read access to this workspace cannot carry docket:write/)
    const { id } = await issue('u-vi', ['docket:read'])
    const { rows } = await db.admin.query('SELECT scopes FROM platform.api_tokens WHERE id = $1', [id])
    // docket:read implies ontology:read (§8.4).
    expect(rows[0]?.scopes).toEqual(['docket:read', 'ontology:read'])
  })

  it('carries ontology:write only where the workspace lets the owner\'s role change the ontology', async () => {
    await expect(issue('u-ed', ['ontology:write'])).rejects.toThrow(/token with write access to this workspace cannot carry ontology:write here: this workspace's settings do not let the editor role/)
    await expect(issue('u-ed', ['ontology:write'], { ontologyWriters: ['owner'] })).rejects.toBeInstanceOf(ApiTokenError)
    await expect(issue('u-vi', ['ontology:write'], { ontologyWriters: ['owner', 'admin', 'editor'] })).rejects.toThrow(/token with read access to this workspace cannot carry ontology:write\.$/)
    const { id } = await issue('u-ed', ['docket:read', 'ontology:write'], { ontologyWriters: ['editor'] })
    const { rows } = await db.admin.query('SELECT scopes FROM platform.api_tokens WHERE id = $1', [id])
    expect(rows[0]?.scopes).toEqual(['docket:read', 'ontology:read', 'ontology:write'])
  })

  it('is refused for a workspace its owner holds no grant on, or an org they are not in', async () => {
    const onWs3 = platform((tx) => issueApiToken(tx, { orgId: 'orga', workspaceId: 'ws3', ownerId: 'u-ed', createdBy: 'u-ed', scopes: ['docket:read'] }))
    await expect(onWs3).rejects.toThrow(/no access to this workspace/)
    const elsewhere = platform((tx) => issueApiToken(tx, { orgId: 'orgb', workspaceId: 'ws1', ownerId: 'u-ed', createdBy: 'u-ed', scopes: ['docket:read'] }))
    await expect(elsewhere).rejects.toThrow(/not a member of this organisation/)
  })

  it('resolves only on its own workspace', async () => {
    const { token } = await issue('u-ed', ['docket:read'])
    const resolver = tokenResolver({ platform })
    const own = await resolver.resolveBearer(token, { url: 'https://d.test/mcp/acme/one', orgId: 'orga', workspaceId: 'ws1' })
    expect(own).toMatchObject({ userId: 'u-ed', orgId: 'orga', workspaceId: 'ws1', via: 'token', actor: `token:${token.slice(0, 17)}` })
    expect(await resolver.resolveBearer(token, { url: 'https://d.test/mcp/acme/two', orgId: 'orga', workspaceId: 'ws2' })).toBeNull()
    // Live for some workspace: a caller on another one is told it was not found, not that the token is bad.
    expect(await resolver.isLive(token)).toBe(true)
    expect(await resolver.isLive(newApiToken())).toBe(false)
  })

  it('stops resolving once expired', async () => {
    const { token } = await issue('u-ed', ['docket:read'], { expiresInDays: 1 })
    const later = new Date(Date.now() + 2 * 86_400_000)
    const resolver = tokenResolver({ platform, now: () => later })
    expect(await resolver.resolveBearer(token, { url: 'https://d.test/mcp/acme/one', orgId: 'orga', workspaceId: 'ws1' })).toBeNull()
    expect(await resolver.isLive(token)).toBe(false)
  })
})
