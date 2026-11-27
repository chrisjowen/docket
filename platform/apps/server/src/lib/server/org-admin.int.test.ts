// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit, listAudit, verifyChainIn } from '@docket/platform-audit'
import { ApiTokenError, effectiveScopes, issueApiToken, tokenResolver } from '@docket/platform-auth'
import { insertWorkspace, listWorkspaces, workspaceById, workspaceBySlug } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { template } from '@docket/platform-ontology-service'
import { insertOrg, listMembers, mintMasterKey, namespaceAccess, newTenantId, type MintedMasterKey, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter as addressLimiter } from './rate-limit'
import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))
const { handleOrgAdmin } = await import('./org-admin')

// Real Postgres roles, migrations, key issuance and audit chain; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)('org admin HTTP endpoints', () => {
  let org: TestOrg
  let master: MintedMasterKey
  let otherSlug: string
  const orgSlug = () => `o-${org.orgId}`

  beforeAll(async () => {
    org = await createTestOrg()
    master = await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId }))
    const otherId = newTenantId()
    otherSlug = `o-${otherId}`
    await org.router.withPlatform((tx) => insertOrg(tx, { id: otherId, slug: otherSlug, name: 'Other org', ownerId: org.userId }))
    await org.db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [otherId])
    runtime = { router: org.router, keyring: org.keyring, origin: 'https://docket.example' } as Runtime
  })
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 100, windowMs: 60_000 })
  })
  afterAll(() => org?.drop())

  async function call(method: string, path: string, body?: unknown, options: { org?: string; bearer?: string | null; query?: string } = {}) {
    const slug = options.org ?? orgSlug()
    const url = new URL(`https://docket.example/api/admin/o/${slug}/${path}${options.query ?? ''}`)
    const headers: Record<string, string> = {}
    if (options.bearer !== null) headers.authorization = `Bearer ${options.bearer ?? master.key}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const event = {
      params: { org: slug, path }, url,
      request: new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      locals: { requestId: randomUUID(), startedAt: performance.now() }, getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
    return handleOrgAdmin(event)
  }
  const create = (slug: string, extra: Record<string, unknown> = {}) => call('POST', 'databases', { name: slug, slug, owner_ref: `owner:${slug}`, ontology: { template: 'blank' }, ...extra })

  it('refuses missing, malformed, expired, revoked and cross-org master keys without touching tenant data', async () => {
    for (const options of [{ bearer: null }, { bearer: 'not-a-master-key' }, { org: otherSlug }]) {
      const response = await call('POST', 'databases', { name: 'Forbidden' }, options)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'invalid_token', request_id: expect.any(String) })
    }
    const revoked = await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId }))
    await org.db.admin.query('UPDATE platform.org_master_keys SET revoked_at = now() WHERE id = $1', [revoked.id])
    expect((await call('GET', 'usage', undefined, { bearer: revoked.key })).status).toBe(401)
    const expired = await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId }))
    await org.db.admin.query("UPDATE platform.org_master_keys SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id])
    expect((await call('GET', 'usage', undefined, { bearer: expired.key })).status).toBe(401)
    expect(await org.withOrg(({ tx }) => listWorkspaces(tx))).toHaveLength(0)
    const events = await org.router.withPlatform((tx) => listAudit(tx))
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.actor === 'anonymous' && event.orgId === null && event.action === 'org.admin.auth' && event.target.includes('burst:true'))).toBe(true)
  })

  it('blocks an address after repeated refused credentials, even with a valid key', async () => {
    runtime.refusedAuth = addressLimiter({ limit: 2, windowMs: 60_000 })
    expect((await call('GET', 'usage', undefined, { bearer: 'junk' })).status).toBe(401)
    expect((await call('GET', 'usage', undefined, { query: '?access_token=junk' })).status).toBe(400)
    const blocked = await call('GET', 'usage')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    expect(await blocked.json()).toMatchObject({ error: 'rate_limited', request_id: expect.any(String) })
  })

  it('creates from templates and inline ontology, and retries by owner_ref without renaming or duplicating', async () => {
    const response = await create('alice')
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const database = await response.json()
    expect(database).toMatchObject({ slug: 'alice', name: 'alice', owner_ref: 'owner:alice', status: 'active', ontology_version: 1, request_id: expect.any(String) })
    const retry = await create('alice', { name: 'A renamed retry' })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ id: database.id, name: 'alice' })
    expect((await call('POST', 'databases', { name: 'Retry without optional fields', owner_ref: 'owner:alice' })).status).toBe(200)
    expect((await create('alice', { owner_ref: 'owner:bob' })).status).toBe(409)
    expect((await create('different', { owner_ref: 'owner:alice' })).status).toBe(409)
    expect((await create('alice', { ontology: { template: 'lean-catalogue' } })).status).toBe(409)
    // An inline copy of a template has exactly the stored head's text and is the same ontology.
    expect((await create('alice', { ontology: { inline_yaml: template('blank').yaml } })).status).toBe(200)
    const automatic = await call('POST', 'databases', { name: 'Auto Name', owner_ref: 'auto:1', ontology: { inline_yaml: template('lean-catalogue').yaml } })
    expect(automatic.status).toBe(201)
    expect(await automatic.json()).toMatchObject({ slug: expect.stringMatching(/^auto-name-/), ontology_version: 1 })
    const get = await call('GET', 'databases/alice')
    expect(await get.json()).toMatchObject({ id: database.id, key_count: 0, ontology: { version: 1, yaml: template('blank').yaml } })
  })

  it('serialises simultaneous retries and conflicting requests', async () => {
    const secondMaster = await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId }))
    const same = await Promise.all([create('concurrent'), create('concurrent')])
    expect(same.map((response) => response.status).sort()).toEqual([200, 201])
    const different = await Promise.all([create('shared-slug', { owner_ref: 'racer:1' }), call('POST', 'databases', { name: 'shared-slug', slug: 'shared-slug', owner_ref: 'racer:2', ontology: { template: 'blank' } }, { bearer: secondMaster.key })])
    expect(different.map((response) => response.status).sort()).toEqual([201, 409])
  })

  it('counts UI databases and grace rows against the admin limit, but not its databases against the members\' beta limit; retries still succeed at the limit', async () => {
    await org.withOrg(async ({ tx }) => {
      const workspace = await insertWorkspace(tx, { name: 'Member workspace', slug: 'member-created', createdBy: org.userId })
      await audit(tx, { orgId: org.orgId, workspaceId: workspace.id, actor: `user:${org.userId}`, action: 'workspace.create', outcome: 'ok', requestId: 'member-create', latencyMs: 0 })
    })
    const count = await org.withOrg(async ({ tx }) => Number((await tx.query<{ count: string }>('SELECT count(*) FROM workspaces')).rows[0]?.count))
    await org.db.admin.query('UPDATE platform.orgs SET admin_database_limit = $2 WHERE id = $1', [org.orgId, count + 2])
    // The admin API may exceed the UI beta limit, with only the per-org admin limit applying.
    expect((await create('limit-one')).status).toBe(201)
    expect((await create('limit-two')).status).toBe(201)
    expect((await create('limit-one')).status).toBe(200)
    expect((await create('limit-over')).status).toBe(403)
    expect((await call('DELETE', 'databases/limit-one')).status).toBe(204)
    expect((await create('limit-over')).status).toBe(403)
    // The API's databases leave the members' beta allowance alone.
    expect(await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'UI', slug: 'ui-after-api', createdBy: org.userId }))).toMatchObject({ slug: 'ui-after-api' })
    await org.db.admin.query('UPDATE platform.orgs SET admin_database_limit = 1000 WHERE id = $1', [org.orgId])
  })

  it('publishes replacement ontology and checks it through the normal service', async () => {
    const replaced = await call('PUT', 'databases/alice/ontology', { template: 'lean-catalogue' })
    expect(replaced.status).toBe(200)
    expect(await replaced.json()).toMatchObject({ version: 2, published_at: expect.any(String) })
    expect((await create('alice')).status).toBe(409)
    expect((await create('alice', { ontology: { template: 'lean-catalogue' } })).status).toBe(200)
    expect((await call('PUT', 'databases/alice/ontology', { inline_yaml: 'not: [valid' })).status).toBe(400)
    expect((await call('PUT', 'databases/alice/ontology', { ontology: { template: 'blank' } })).status).toBe(400)
    expect(await (await call('GET', 'databases/alice')).json()).toMatchObject({ ontology_version: 2 })
  })

  it('issues workspace-scoped keys owned by the database\'s read or write account, lists only metadata, and revokes them', async () => {
    const response = await call('POST', 'databases/alice/keys', { description: 'MCP agent', scopes: ['docket:read'] })
    expect(response.status).toBe(201)
    const issued = await response.json()
    expect(Boolean(issued.key)).toBe(true)
    expect(Math.round((Date.parse(issued.expires_at) - Date.parse(issued.created_at)) / 86400000)).toBe(90)
    const resolver = tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 })
    const workspace = await org.withOrg(({ tx }) => workspaceBySlug(tx, 'alice'))
    const resource = { orgId: org.orgId, workspaceId: workspace!.id, url: `https://docket.example/mcp/${orgSlug()}/alice` }
    const principal = await resolver.resolveBearer(issued.key, resource)
    expect(principal?.userId).not.toBe(master.orgAdminId)
    expect(principal?.scopes).toEqual(['docket:read', 'ontology:read'])
    const platform = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)
    expect(await effectiveScopes(principal!, { platform })).toEqual(['docket:read', 'ontology:read'])
    // The read account reads this database and nothing else; a write key goes to its write account.
    expect(await org.router.withPlatform((tx) => namespaceAccess(tx, org.orgId, workspace!.id, principal!.userId))).toMatchObject({ accountRole: 'guest', permission: 'read' })
    const concurrent = await org.withOrg(({ tx }) => workspaceBySlug(tx, 'concurrent'))
    expect(await org.router.withPlatform((tx) => namespaceAccess(tx, org.orgId, concurrent!.id, principal!.userId))).toMatchObject({ permission: null })
    const writer = await (await call('POST', 'databases/alice/keys', { description: 'Writer' })).json()
    const writes = await resolver.resolveBearer(writer.key, resource)
    expect(writes?.userId).not.toBe(principal?.userId)
    expect(await effectiveScopes(writes!, { platform })).toEqual(['docket:read', 'docket:write', 'ontology:read'])
    const again = await (await call('POST', 'databases/alice/keys', { scopes: ['docket:read'] })).json()
    expect((await resolver.resolveBearer(again.key, resource))?.userId).toBe(principal?.userId)
    // The accounts are the API's, not members: the members page and its token form never offer them.
    expect((await org.router.withPlatform((tx) => listMembers(tx, org.orgId))).map((member) => member.id)).not.toContain(principal?.userId)
    expect(await resolver.resolveBearer(issued.key, { ...resource, workspaceId: 'elsewhere' })).toBeNull()
    expect((await call('GET', 'usage', undefined, { bearer: issued.key })).status).toBe(401)
    const listed = await (await call('GET', 'databases/alice/keys')).json()
    expect(listed.keys).toContainEqual(expect.objectContaining({ id: issued.id, description: 'MCP agent' }))
    expect(listed.keys.every((key: Record<string, unknown>) => !('key' in key) && !('token_hash' in key))).toBe(true)
    expect((await call('DELETE', `databases/concurrent/keys/${issued.id}`)).status).toBe(404)
    expect((await call('DELETE', `databases/alice/keys/${issued.id}`)).status).toBe(204)
    expect(await resolver.isLive(issued.key)).toBe(false)
    for (const body of [{ ttl_days: 91 }, { ttl_days: 0 }, { scopes: [] }, { scopes: ['ontology:write'] }, { description: 42 }]) {
      expect((await call('POST', 'databases/alice/keys', body)).status).toBe(400)
    }
  })

  it("counts a personal token that reaches every docket of the account toward a database's key_count", async () => {
    const before = await (await call('GET', 'databases/alice')).json()
    await org.router.withPlatform((tx) => issueApiToken(tx, { orgId: org.orgId, ownerId: org.userId, createdBy: org.userId, dockets: null }))
    const after = await (await call('GET', 'databases/alice')).json()
    expect(after.key_count).toBe(before.key_count + 1)
  })

  it('issues no key for a database made in Docket Cloud, and org-admin holds no grant to issue one with', async () => {
    const workspace = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Team handbook', slug: 'ui-handbook', createdBy: org.userId }))
    for (const body of [{}, { scopes: ['docket:read'] }]) {
      const refused = await call('POST', 'databases/ui-handbook/keys', body)
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ error: 'forbidden' })
    }
    const { rows } = await org.db.admin.query('SELECT 1 FROM platform.api_tokens WHERE $1 = ANY (dockets)', [workspace.id])
    expect(rows).toEqual([])
    const events = await org.withOrg(({ tx }) => listAudit(tx, { action: 'org.admin.key.issue', limit: 1 }))
    expect(events[0]).toMatchObject({ actor: `token:${master.id}`, outcome: 'denied', target: ['database:ui-handbook'] })
    // org-admin is a provisioner: it reaches no database, so no key could be issued in its name either.
    expect(await org.router.withPlatform((tx) => namespaceAccess(tx, org.orgId, workspace.id, master.orgAdminId))).toMatchObject({ accountRole: 'provisioner', permission: null })
    const { rows: grants } = await org.db.admin.query('SELECT 1 FROM platform.namespace_grants WHERE principal_id = $1', [master.orgAdminId])
    expect(grants).toEqual([])
    await expect(org.router.withPlatform((tx) => issueApiToken(tx, { orgId: org.orgId, dockets: [workspace.id], ownerId: master.orgAdminId,
      createdBy: master.orgAdminId }))).rejects.toBeInstanceOf(ApiTokenError)
  })

  it('rolls key creation back if the transactional audit cannot be written', async () => {
    const before = await org.db.admin.query<{ count: string }>('SELECT count(*) FROM platform.api_tokens WHERE org_id = $1', [org.orgId])
    const original = runtime.router
    let enters = 0
    runtime.router = { ...org.router, async enterTenant(tx, orgId) {
      enters += 1
      if (enters === 2) throw new Error('Simulated audit routing failure')
      await org.router.enterTenant(tx, orgId)
    } }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect((await call('POST', 'databases/alice/keys', {})).status).toBe(500)
    } finally {
      runtime.router = original
      quiet.mockRestore()
    }
    const after = await org.db.admin.query<{ count: string }>('SELECT count(*) FROM platform.api_tokens WHERE org_id = $1', [org.orgId])
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
    const events = await org.withOrg(({ tx }) => listAudit(tx, { action: 'org.admin.key.issue', limit: 1 }))
    expect(events[0]).toMatchObject({ actor: `token:${master.id}`, outcome: 'error' })
  })

  it('soft-deletes idempotently, reserves identity, hides UI/MCP lookups and revokes all database credentials', async () => {
    const created = await create('grace')
    const row = await created.json()
    const issued = await (await call('POST', 'databases/grace/keys', {})).json()
    expect((await call('DELETE', 'databases/grace')).status).toBe(204)
    const deletedAt = await org.withOrg(async ({ tx }) => (await tx.query<{ deleted_at: Date }>('SELECT deleted_at FROM workspaces WHERE id = $1', [row.id])).rows[0]?.deleted_at)
    expect((await call('DELETE', 'databases/grace')).status).toBe(204)
    expect(await org.withOrg(async ({ tx }) => (await tx.query<{ deleted_at: Date }>('SELECT deleted_at FROM workspaces WHERE id = $1', [row.id])).rows[0]?.deleted_at)).toEqual(deletedAt)
    expect((await call('GET', 'databases/grace')).status).toBe(404)
    expect((await call('POST', 'databases/grace/keys', {})).status).toBe(404)
    expect((await call('PUT', 'databases/grace/ontology', { template: 'blank' })).status).toBe(404)
    expect((await create('grace')).status).toBe(409)
    expect((await create('grace-new', { owner_ref: 'owner:grace' })).status).toBe(409)
    expect((await create('grace', { owner_ref: 'new:owner' })).status).toBe(409)
    const active = await (await call('GET', 'databases')).json()
    const deleted = await (await call('GET', 'databases', undefined, { query: '?status=deleted' })).json()
    const all = await (await call('GET', 'databases', undefined, { query: '?status=all' })).json()
    expect(active.databases.some((database: { id: string }) => database.id === row.id)).toBe(false)
    expect(deleted.databases).toContainEqual(expect.objectContaining({ id: row.id, status: 'deleted' }))
    expect(all.databases.length).toBe(active.databases.length + deleted.databases.length)
    expect(await org.withOrg(({ tx }) => workspaceBySlug(tx, 'grace'))).toBeNull()
    expect(await org.withOrg(({ tx }) => workspaceById(tx, row.id))).toBeNull()
    const resolver = tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 })
    expect(await resolver.isLive(issued.key)).toBe(false)
  })

  it('reports usage, filters audit before pagination, and audits every call in a valid hash chain', async () => {
    const usage = await (await call('GET', 'usage')).json()
    expect(usage).toMatchObject({ databases: expect.any(Number), active_keys: expect.any(Number), calls_30d: expect.any(Number), storage_bytes: expect.any(Number), database_limit: 1000 })
    expect(usage.storage_bytes).toBeGreaterThan(0)
    const response = await call('GET', 'audit', undefined, { query: '?entity=database&slug=alice&action=org.admin.database.create&since=2020-01-01T00:00:00Z' })
    const { events } = await response.json()
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event: { actor: string; action: string; target: string[] }) => event.actor === `token:${master.id}` && event.action === 'org.admin.database.create' && event.target.includes('database:alice'))).toBe(true)
    for (const path of ['databases?status=bogus', 'audit?entity=other', 'audit?since=invalid']) {
      const [route, query] = path.split('?')
      expect((await call('GET', route!, undefined, { query: `?${query}` })).status).toBe(400)
    }
    const memberAudit = await (await call('GET', 'audit', undefined, { query: '?entity=database&slug=member-created' })).json()
    expect(memberAudit.events).toContainEqual(expect.objectContaining({ action: 'workspace.create', actor: `user:${org.userId}` }))
    expect(await org.withOrg(({ tx }) => verifyChainIn(tx))).toMatchObject({ ok: true })
  })

  it('applies 60 calls per master key and 10 key creations per minute, auditing refusals', async () => {
    for (let i = 0; i < 60; i++) expect((await call('GET', 'usage')).status).toBe(200)
    expect((await call('GET', 'usage')).status).toBe(429)
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    for (let i = 0; i < 10; i++) expect((await call('POST', 'databases/alice/keys', {})).status).toBe(201)
    const refused = await call('POST', 'databases/alice/keys', {})
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBeTruthy()
    const events = await org.withOrg(({ tx }) => listAudit(tx, { action: 'org.admin.key.issue', limit: 1 }))
    expect(events[0]).toMatchObject({ actor: `token:${master.id}`, outcome: 'denied' })
  })
})
