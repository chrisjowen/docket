// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, accessOf, docketPlace, removeMember, setGrant, tenantRouter, type Access, type TenantRouter, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkScope, effectiveScopes } from './effective-permission.js'
import type { McpResource, Principal } from './principal.js'
import { fromLegacyScopes, type Scope } from './scopes.js'
import { issueApiToken } from './tokens/api-token.js'
import { tokenResolver } from './tokens/lookup.js'
import { listenForRevocations, revokeApiToken, type RevocationListener } from './tokens/revocation.js'

const resource: McpResource = { url: 'https://d.test/mcp/acme/platform', orgId: 'orga', workspaceId: 'ws1' }

describe.skipIf(!TEST_PG_URL)('effective permission', () => {
  let db: TestDatabase
  let router: TenantRouter
  let listener: RevocationListener
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => router.withPlatform(fn)
  // A TTL far longer than the test: only a revocation notice can clear the cache.
  const resolver = tokenResolver({ platform: (fn) => platform(fn), ttlMs: 10 * 60_000 })

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
    await db.admin.query(`
      INSERT INTO platform.users (id, kind, github_id, login) VALUES
        ('u-own', 'human', 1, 'own'), ('u-ed', 'human', 2, 'ed'), ('u-gone', 'human', 3, 'gone'),
        ('u-adm', 'human', 4, 'adm'), ('u-dev', 'human', 5, 'dev'), ('u-ro', 'human', 6, 'ro'),
        ('u-guest', 'human', 7, 'guest'), ('u-out', 'human', 8, 'out'), ('u-dev2', 'human', 9, 'dev2');
      INSERT INTO platform.orgs (id, slug, name, status, created_by) VALUES ('orga', 'acme', 'Acme', 'active', 'u-own');
      INSERT INTO platform.users (id, kind, service_org_id, login) VALUES ('u-prov', 'service', 'orga', 'prov');
      INSERT INTO platform.memberships (org_id, user_id, owner, guest) VALUES
        ('orga', 'u-own', true, false), ('orga', 'u-ed', false, false), ('orga', 'u-gone', false, false),
        ('orga', 'u-adm', false, false), ('orga', 'u-dev', false, false), ('orga', 'u-dev2', false, false), ('orga', 'u-ro', false, false),
        ('orga', 'u-guest', false, true), ('orga', 'u-out', false, true), ('orga', 'u-prov', false, false);
      -- A role that sets things up and reads nothing.
      INSERT INTO platform.roles (id, org_id, name, caps) VALUES ('r_prov', 'orga', 'Provisioner', ARRAY['create', 'access', 'audit']);
      -- Roles on the whole account, and on one docket: Writer on ws2 only for u-dev2, Reader on ws1 for one
      -- guest, and a provisioner that manages access everywhere but reads nothing.
      INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id) VALUES
        ('g1', 'orga', 'u-ed', 'account', NULL, 'writer'), ('g2', 'orga', 'u-gone', 'account', NULL, 'writer'),
        ('g3', 'orga', 'u-ro', 'account', NULL, 'reader'), ('g4', 'orga', 'u-dev', 'account', NULL, 'writer'),
        ('g5', 'orga', 'u-adm', 'account', NULL, 'admin'), ('g6', 'orga', 'u-dev2', 'docket', 'ws2', 'writer'),
        ('g7', 'orga', 'u-guest', 'docket', 'ws1', 'reader'), ('g8', 'orga', 'u-prov', 'account', NULL, 'r_prov');
    `)
    listener = listenForRevocations({ connect: () => new pg.Client({ connectionString: db.url('app') }), onRevoked: () => resolver.forget() })
    for (let waited = 0; !listener.connected && waited < 5_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50))
  }, 60_000)

  afterAll(async () => {
    await listener?.close()
    await db?.drop()
  })

  const principalFor = (userId: string): Principal => ({
    userId,
    orgId: 'orga',
    workspaceId: 'ws1',
    scopes: [],
    via: 'token',
    tokenId: 'tok_test',
    actor: 'token:dkt_live_test',
    expiresAt: new Date(Date.now() + 60_000),
  })

  const issue = (ownerId: string, scopes: Scope[]) => {
    const { readOnly, legacy } = fromLegacyScopes(scopes)
    return platform((tx) => issueApiToken(tx, { orgId: 'orga', dockets: ['ws1'], ownerId, createdBy: ownerId, readOnly, legacyScopes: legacy }))
  }

  const owner = async (): Promise<Access> => (await platform((tx) => accessOf(tx, 'orga', 'u-own'))) as Access

  /** What the MCP endpoint does on every call: resolve, then cut to the grants now. */
  async function call(token: string, needed: 'docket:read' | 'docket:write') {
    const principal = await resolver.resolveBearer(token, resource)
    if (!principal) return { status: 401 }
    const refusal = checkScope(await effectiveScopes(principal, { platform }), needed)
    return refusal ? { status: refusal.status, error: refusal.error } : { status: 200 }
  }

  it('demotion narrows live token', async () => {
    const { token } = await issue('u-ed', ['docket:read', 'docket:write'])
    expect(await call(token, 'docket:write')).toEqual({ status: 200 })

    const actor = await owner()
    await platform((tx) => setGrant(tx, { orgId: 'orga', who: { kind: 'user', id: 'u-ed' }, place: ACCOUNT, roleId: 'reader', actor, actorId: 'u-own' }))

    // The lookup is still cached; the grants are not.
    expect(await call(token, 'docket:write')).toEqual({ status: 403, error: 'insufficient_scope' })
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
  })

  it('ontology:write follows Publish ontology changes, given on one docket to one person, on every call', async () => {
    // A token that acts as its owner, narrowed by nothing, carries ontology:write only while they hold Publish there.
    const { token } = await platform((tx) => issueApiToken(tx, { orgId: 'orga', dockets: ['ws1'], ownerId: 'u-dev', createdBy: 'u-dev', legacyScopes: ['docket:read', 'ontology:write'] }))
    const principal = await resolver.resolveBearer(token, resource)
    if (!principal) throw new Error('unresolved')
    const effective = () => effectiveScopes(principal, { platform })
    expect(await effective()).toEqual(['docket:read', 'ontology:read'])
    const actor = await owner()
    const { grant } = await platform((tx) =>
      setGrant(tx, { orgId: 'orga', who: { kind: 'user', id: 'u-dev' }, place: docketPlace('ws1'), roleId: 'writer', add: ['publish'], actor, actorId: 'u-own' }),
    )
    expect(await effective()).toEqual(['docket:read', 'ontology:read', 'ontology:write'])
    // Not on the other docket: the grant is on ws1 alone.
    expect(await effectiveScopes({ ...principal, workspaceId: 'ws2' }, { platform })).toEqual(['docket:read', 'ontology:read'])
    await db.admin.query('DELETE FROM platform.grants WHERE id = $1', [grant.id])
    expect(await effective()).toEqual(['docket:read', 'ontology:read'])
  })

  it('cuts every credential to what its owner may do on the docket: every grant that covers it', async () => {
    const scopes: Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
    const asIf = (userId: string) => effectiveScopes({ ...principalFor(userId), scopes }, { platform })
    const write = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
    const read = ['docket:read', 'ontology:read']
    // Owners and account admins reach every docket.
    expect(await asIf('u-own')).toEqual(write)
    expect(await asIf('u-adm')).toEqual(write)
    // Everyone else reaches what a grant on the account or the docket gives.
    expect(await asIf('u-dev')).toEqual(write)
    expect(await asIf('u-ro')).toEqual(read)
    expect(await asIf('u-guest')).toEqual(read)
    // Nothing without a grant here: u-dev2's is on ws2, u-out has none; a role without Read and ask reaches no content.
    expect(await asIf('u-dev2')).toEqual([])
    expect(await asIf('u-out')).toEqual([])
    expect(await asIf('u-prov')).toEqual([])
    expect(checkScope(await asIf('u-dev2'), 'docket:read')).toMatchObject({ status: 401, error: 'invalid_token' })
  })

  it('taking a grant away leaves the token nothing on that docket', async () => {
    const { token } = await issue('u-ro', ['docket:read'])
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
    await db.admin.query("DELETE FROM platform.grants WHERE principal_id = 'u-ro'")
    expect(await call(token, 'docket:read')).toEqual({ status: 401, error: 'invalid_token' })
  })

  it('removal leaves the token nothing', async () => {
    const { token } = await issue('u-gone', ['docket:read'])
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
    const actor = await owner()
    await platform((tx) => removeMember(tx, { orgId: 'orga', userId: 'u-gone', actor }))
    expect(await call(token, 'docket:read')).toEqual({ status: 401, error: 'invalid_token' })
  })

  it('revoked token fails next call', async () => {
    const { token, id } = await issue('u-own', ['docket:read'])
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })

    const revokedAt = Date.now()
    await platform((tx) => revokeApiToken(tx, { orgId: 'orga', tokenId: id, by: 'u-own' }))
    await expect.poll(() => call(token, 'docket:read'), { timeout: 1_000, interval: 20 }).toEqual({ status: 401 })
    expect(Date.now() - revokedAt).toBeLessThan(1_000)
  })
})
