// SPDX-License-Identifier: AGPL-3.0-only
import { changeRole, removeMember, tenantRouter, type TenantRouter, type Tx } from '@docket/platform-tenancy'
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
      INSERT INTO platform.memberships (org_id, user_id, role) VALUES
        ('orga', 'u-own', 'owner'), ('orga', 'u-ed', 'editor'), ('orga', 'u-gone', 'editor'),
        ('orga', 'u-adm', 'admin'), ('orga', 'u-dev', 'editor'), ('orga', 'u-dev2', 'editor'), ('orga', 'u-ro', 'viewer');
      INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES
        ('orga', 'u-guest', 'viewer', 'guest'), ('orga', 'u-out', 'viewer', 'guest'), ('orga', 'u-prov', 'editor', 'provisioner');
      -- What the 0016 backfill gives today's members, and grants made by hand: a write grant on ws2 only for
      -- u-dev2, a read grant for one guest, and a write grant a provisioner holds but must never use.
      INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES
        ('orga', 'ws1', 'u-ed', 'write'), ('orga', 'ws1', 'u-gone', 'write'), ('orga', 'ws1', 'u-ro', 'read'),
        ('orga', 'ws1', 'u-dev', 'write'), ('orga', 'ws2', 'u-dev2', 'write'), ('orga', 'ws1', 'u-guest', 'read'), ('orga', 'ws1', 'u-prov', 'write');
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

  /** What the MCP endpoint does on every call: resolve, then cut to the role now. */
  async function call(token: string, needed: 'docket:read' | 'docket:write') {
    const principal = await resolver.resolveBearer(token, resource)
    if (!principal) return { status: 401 }
    const refusal = checkScope(await effectiveScopes(principal, { platform }), needed)
    return refusal ? { status: refusal.status, error: refusal.error } : { status: 200 }
  }

  it('demotion narrows live token', async () => {
    const { token } = await issue('u-ed', ['docket:read', 'docket:write'])
    expect(await call(token, 'docket:write')).toEqual({ status: 200 })

    await platform((tx) => changeRole(tx, { orgId: 'orga', userId: 'u-ed', role: 'viewer', actorRole: 'owner' }))

    // The lookup is still cached; the role is not.
    expect(await call(token, 'docket:write')).toEqual({ status: 403, error: 'insufficient_scope' })
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
  })

  it('ontology:write follows the workspace setting and the role, on every call', async () => {
    // A token that acts as its owner, narrowed by nothing, carries ontology:write only while the setting names their role.
    const { token } = await platform((tx) => issueApiToken(tx, { orgId: 'orga', dockets: ['ws1'], ownerId: 'u-own', createdBy: 'u-own', legacyScopes: ['docket:read', 'ontology:write'] }))
    const principal = await resolver.resolveBearer(token, resource)
    if (!principal) throw new Error('unresolved')
    let writers: ('owner' | 'admin' | 'editor')[] = ['owner', 'editor']
    const effective = () => effectiveScopes(principal, { platform, ontologyWriters: async () => writers })
    expect(await effective()).toEqual(['docket:read', 'ontology:read', 'ontology:write'])
    // The owner turns it off, or leaves only editors on: the owner's own token loses it at once.
    writers = ['editor']
    expect(await effective()).toEqual(['docket:read', 'ontology:read'])
    writers = []
    expect(await effective()).toEqual(['docket:read', 'ontology:read'])
    // A caller that does not read the setting never gets it.
    writers = ['owner']
    expect(await effectiveScopes(principal, { platform })).toEqual(['docket:read', 'ontology:read'])
  })

  it('cuts every credential to its owner\'s permission on the workspace: account role, then grant', async () => {
    const scopes: Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
    const asIf = (userId: string) => effectiveScopes({ ...principalFor(userId), scopes }, { platform })
    const write = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
    const read = ['docket:read', 'ontology:read']
    // Owners and admins are admin on every workspace, with no grant.
    expect(await asIf('u-own')).toEqual(write)
    expect(await asIf('u-adm')).toEqual(write)
    // Developers and read-only members reach what they are granted, at its level.
    expect(await asIf('u-dev')).toEqual(write)
    expect(await asIf('u-ro')).toEqual(read)
    expect(await asIf('u-guest')).toEqual(read)
    // Nothing without a grant here: u-dev2's is on ws2, u-out has none; a provisioner reaches no content even granted.
    expect(await asIf('u-dev2')).toEqual([])
    expect(await asIf('u-out')).toEqual([])
    expect(await asIf('u-prov')).toEqual([])
    expect(checkScope(await asIf('u-dev2'), 'docket:read')).toMatchObject({ status: 401, error: 'invalid_token' })
  })

  it('taking a grant away leaves the token nothing on that workspace', async () => {
    const { token } = await issue('u-ro', ['docket:read'])
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
    await db.admin.query("DELETE FROM platform.namespace_grants WHERE principal_id = 'u-ro'")
    expect(await call(token, 'docket:read')).toEqual({ status: 401, error: 'invalid_token' })
  })

  it('removal leaves the token nothing', async () => {
    const { token } = await issue('u-gone', ['docket:read'])
    expect(await call(token, 'docket:read')).toEqual({ status: 200 })
    await platform((tx) => removeMember(tx, { orgId: 'orga', userId: 'u-gone', actorRole: 'owner' }))
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
