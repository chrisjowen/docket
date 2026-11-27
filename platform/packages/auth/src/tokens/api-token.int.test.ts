// SPDX-License-Identifier: AGPL-3.0-only
import { tenantRouter, type TenantRouter, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiTokenError, issueApiToken, listApiTokens, newApiToken, renameApiToken, tokenHash, type IssueApiTokenInput } from './api-token.js'
import { tokenResolver } from './lookup.js'
import { revokeApiToken, revokeWorkspaceCredentials } from './revocation.js'

describe.skipIf(!TEST_PG_URL)('API tokens in Postgres', () => {
  let db: TestDatabase
  let router: TenantRouter
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)
  const on = (workspaceId: string) => ({ url: `https://d.test/mcp/acme/${workspaceId}`, orgId: 'orga', workspaceId })

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES ('u-ed', 'human', 1, 'ed'), ('u-vi', 'human', 2, 'vi');
      INSERT INTO platform.orgs (id, slug, name, status, created_by) VALUES ('orga', 'acme', 'Acme', 'active', 'u-ed');
      INSERT INTO platform.users (id, kind, login, service_org_id, created_by) VALUES ('u-bot', 'service', 'ci-bot', 'orga', 'u-ed');
      INSERT INTO platform.memberships (org_id, user_id) VALUES ('orga', 'u-ed'), ('orga', 'u-vi'), ('orga', 'u-bot');
      INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES
        ('g1', 'orga', 'u-ed', 'docket', 'ws1', 'writer'), ('g2', 'orga', 'u-ed', 'docket', 'ws2', 'writer'),
        ('g3', 'orga', 'u-vi', 'docket', 'ws1', 'reader'), ('g4', 'orga', 'u-bot', 'docket', 'ws1', 'reader');
    `)
  }, 60_000)

  afterAll(async () => {
    await db?.drop()
  })

  const issue = (ownerId: string, extra: Partial<IssueApiTokenInput> = {}) =>
    platform((tx) => issueApiToken(tx, { orgId: 'orga', ownerId, createdBy: ownerId, dockets: ['ws1'], ...extra }))

  it('stores only the SHA-256 of the token', async () => {
    const { token, id, kind } = await issue('u-ed')
    expect(kind).toBe('personal')
    const { rows } = await db.superuser.query('SELECT * FROM platform.api_tokens WHERE id = $1', [id])
    const row = rows[0] as Record<string, unknown>
    expect(row.token_hash).toBe(tokenHash(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(token.slice(16, 40))
    expect(row.prefix).toBe(token.slice(0, 16))
    expect(row).toMatchObject({ read_only: false, dockets: ['ws1'], legacy_scopes: null })
  })

  it('lasts at most 90 days for a person (30 by default) and a year for a system account (90 by default)', async () => {
    const { expiresAt } = await issue('u-ed')
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(30)
    await expect(issue('u-ed', { expiresInDays: 91 })).rejects.toBeInstanceOf(ApiTokenError)
    await expect(issue('u-ed', { expiresInDays: 0 })).rejects.toBeInstanceOf(ApiTokenError)
    const system = await issue('u-bot')
    expect(system.token).toMatch(/^dkt_sys_/)
    expect(Math.round((system.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(90)
    expect((await issue('u-bot', { expiresInDays: 365 })).kind).toBe('system')
    await expect(issue('u-bot', { expiresInDays: 366 })).rejects.toBeInstanceOf(ApiTokenError)
  })

  it('is refused on a docket its owner does not reach, or in an org they are not in', async () => {
    await expect(issue('u-ed', { dockets: ['ws3'] })).rejects.toThrow(/no access to one of those dockets/)
    await expect(issue('u-vi', { dockets: ['ws1', 'ws2'] })).rejects.toThrow(/no access to one of those dockets/)
    const elsewhere = platform((tx) => issueApiToken(tx, { orgId: 'orgb', dockets: ['ws1'], ownerId: 'u-ed', createdBy: 'u-ed' }))
    await expect(elsewhere).rejects.toThrow(/not a member of this organisation/)
  })

  it('forces read-only when any of its dockets is read-only for its owner, whatever was asked, and says so in what it returns', async () => {
    const forced = await issue('u-vi', { readOnly: false })
    expect(forced.readOnly).toBe(true)
    const { rows } = await db.superuser.query('SELECT read_only FROM platform.api_tokens WHERE id = $1', [forced.id])
    expect(rows[0]).toMatchObject({ read_only: true })
    expect(await tokenResolver({ platform }).resolveBearer(forced.token, on('ws1'))).toMatchObject({ readOnly: true, scopes: ['docket:read', 'ontology:read'] })
  })

  it('acts as its owner, narrowed to read-only and to its dockets', async () => {
    const resolver = tokenResolver({ platform })
    const pinned = await issue('u-ed')
    expect(await resolver.resolveBearer(pinned.token, on('ws1'))).toMatchObject({
      userId: 'u-ed',
      workspaceId: 'ws1',
      via: 'token',
      readOnly: false,
      dockets: ['ws1'],
      scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'],
      actor: `token:${pinned.token.slice(0, 16)}`,
    })
    expect(await resolver.resolveBearer(pinned.token, on('ws2'))).toBeNull()
    // Live for some workspace: a caller on another one is told it was not found, not that the token is bad.
    expect(await resolver.isLive(pinned.token)).toBe(true)
    expect(await resolver.isLive(newApiToken())).toBe(false)

    const everywhere = await issue('u-ed', { dockets: null, readOnly: true, name: 'laptop' })
    expect(await resolver.resolveBearer(everywhere.token, on('ws2'))).toMatchObject({ readOnly: true, dockets: null, scopes: ['docket:read', 'ontology:read'], credentialName: 'laptop' })
    expect(await resolver.resolveBearer(everywhere.token, { ...on('ws1'), orgId: 'orgb' })).toBeNull()
  })

  it('keeps an old ceiling, and lists, renames and revokes by owner and docket', async () => {
    const capped = await issue('u-ed', { legacyScopes: ['docket:read', 'docket:write'] })
    const resolver = tokenResolver({ platform })
    expect((await resolver.resolveBearer(capped.token, on('ws1')))?.scopes).toEqual(['docket:read', 'docket:write', 'ontology:read'])
    const listed = await platform((tx) => listApiTokens(tx, { orgId: 'orga', workspaceId: 'ws2', ownerId: 'u-ed' }))
    expect(listed.every((token) => token.dockets === null || token.dockets.includes('ws2'))).toBe(true)
    expect(await platform((tx) => renameApiToken(tx, { orgId: 'orga', tokenId: capped.id, ownerId: 'u-ed', name: '  CI\non main ' }))).toMatchObject({ before: null, after: 'CI on main' })
    await expect(platform((tx) => renameApiToken(tx, { orgId: 'orga', tokenId: capped.id, ownerId: 'u-vi', name: 'mine' }))).rejects.toBeInstanceOf(ApiTokenError)

    // A docket's admin revokes anyone's token that reaches only that docket, never one that reaches more.
    const wide = await issue('u-ed', { dockets: ['ws1', 'ws2'] })
    await expect(platform((tx) => revokeApiToken(tx, { orgId: 'orga', tokenId: wide.id, by: 'u-vi', ownOrPinned: { ownerId: 'u-vi', workspaceId: 'ws1' } }))).rejects.toThrow(/No such live token/)
    expect(await platform((tx) => revokeApiToken(tx, { orgId: 'orga', tokenId: capped.id, by: 'u-vi', ownOrPinned: { ownerId: 'u-vi', workspaceId: 'ws1' } }))).toMatchObject({ ownerId: 'u-ed' })

    // Deleting a docket revokes what reached it alone, and takes it off what reached more.
    await platform((tx) => revokeWorkspaceCredentials(tx, { orgId: 'orga', workspaceId: 'ws1', resource: on('ws1').url, by: 'u-ed' }))
    const { rows } = await db.admin.query<{ dockets: string[]; revoked: boolean }>('SELECT dockets, revoked_at IS NOT NULL AS revoked FROM platform.api_tokens WHERE id = $1', [wide.id])
    expect(rows).toEqual([{ dockets: ['ws2'], revoked: false }])
    const { rows: alone } = await db.admin.query<{ count: string }>(
      "SELECT count(*) FROM platform.api_tokens WHERE dockets = ARRAY['ws1'] AND revoked_at IS NULL",
    )
    expect(Number(alone[0]?.count)).toBe(0)
  })

  it('stops resolving once expired', async () => {
    const { token } = await issue('u-ed', { expiresInDays: 1, dockets: ['ws2'] })
    const later = new Date(Date.now() + 2 * 86_400_000)
    const resolver = tokenResolver({ platform, now: () => later })
    expect(await resolver.resolveBearer(token, on('ws2'))).toBeNull()
    expect(await resolver.isLive(token)).toBe(false)
  })
})
