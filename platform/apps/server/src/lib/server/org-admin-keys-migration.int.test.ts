// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { effectiveScopes, issueApiToken, tokenResolver, type McpResource } from '@docket/platform-auth'
import { insertWorkspace, workspaceBySlug } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import { migratePlatform, mintMasterKey, namespaceAccess, transaction, type MintedMasterKey, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import down0014 from '../../../../../packages/tenancy/migrations/platform/0014_database_accounts.down.sql?raw'
import { rateLimiter as addressLimiter } from './rate-limit'
import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))
const { handleOrgAdmin } = await import('./org-admin')

// Platform 0014 against keys the org admin API issued before it, when org-admin owned them all.
describe.skipIf(!TEST_PG_URL)('org admin keys move to database accounts (platform 0014)', () => {
  let org: TestOrg
  let master: MintedMasterKey
  const platform = <T>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)

  beforeAll(async () => {
    org = await createTestOrg()
    master = await org.router.withPlatform((tx) => mintMasterKey(tx, { orgId: org.orgId }))
    const at = Date.now()
    runtime = {
      router: org.router, keyring: org.keyring, origin: 'https://docket.example',
      limiter: rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at }),
      refusedAuth: addressLimiter({ limit: 100, windowMs: 60_000 }),
    } as Runtime
  })
  afterAll(() => org?.drop())

  async function call(method: string, path: string, body?: unknown) {
    const url = new URL(`https://docket.example/api/admin/o/o-${org.orgId}/${path}`)
    const event = {
      params: { org: `o-${org.orgId}`, path }, url,
      request: new Request(url, { method, headers: { authorization: `Bearer ${master.key}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      locals: { requestId: randomUUID(), startedAt: performance.now() }, getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
    return handleOrgAdmin(event)
  }

  it('re-owns every live key without changing its text, keeps what each can do, and takes org-admin\'s grants away', async () => {
    expect((await call('POST', 'databases', { name: 'alice', slug: 'alice', owner_ref: 'user:alice', ontology: { template: 'blank' } })).status).toBe(201)
    const writes = await (await call('POST', 'databases/alice/keys', { description: 'agent' })).json()
    const reads = await (await call('POST', 'databases/alice/keys', { scopes: ['docket:read'] })).json()
    const alice = (await org.withOrg(({ tx }) => workspaceBySlug(tx, 'alice')))!
    const handbook = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Handbook', slug: 'handbook', createdBy: org.userId }))

    // Back to before 0014: org-admin owns the keys again and, as a developer, may write every docket.
    await transaction(org.db.admin, (tx) => tx.query(down0014))
    expect(await platform((tx) => namespaceAccess(tx, org.orgId, handbook.id, master.orgAdminId))).toMatchObject({ accountRole: 'developer', permission: 'write' })
    // What a master key could do then: a write key for a docket a person made in the UI.
    const legacy = await platform((tx) => issueApiToken(tx, { orgId: org.orgId, workspaceId: handbook.id, ownerId: master.orgAdminId,
      createdBy: master.orgAdminId, scopes: ['docket:read', 'docket:write'], expiresInDays: 90 }))
    const { rows: revoked } = await org.db.admin.query<{ id: string }>(
      `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, workspace_id, owner_id, scopes, created_by, expires_at, revoked_at)
       VALUES ('tok_revokedold01', $1, 'dkt_live_y', $2, $3, $4, ARRAY['docket:read'], $4, now() + interval '1 day', now()) RETURNING id`,
      ['0'.repeat(64), org.orgId, alice.id, master.orgAdminId],
    )

    const resolver = tokenResolver({ platform, ttlMs: 0 })
    const resource = (workspaceId: string, slug: string): McpResource => ({ orgId: org.orgId, workspaceId, url: `https://docket.example/mcp/o-${org.orgId}/${slug}` })
    const keys = [
      { key: writes.key as string, at: resource(alice.id, 'alice') },
      { key: reads.key as string, at: resource(alice.id, 'alice') },
      { key: legacy.token, at: resource(handbook.id, 'handbook') },
    ]
    const can = async () => Promise.all(keys.map(async ({ key, at }) => {
      const principal = await resolver.resolveBearer(key, at)
      return { owner: principal?.userId, scopes: principal ? await effectiveScopes(principal, { platform }) : null }
    }))
    const before = await can()
    expect(before.every((key) => key.owner === master.orgAdminId)).toBe(true)
    expect(before.map((key) => key.scopes)).toEqual([
      ['docket:read', 'docket:write', 'ontology:read'], ['docket:read', 'ontology:read'], ['docket:read', 'docket:write', 'ontology:read'],
    ])

    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)

    // The same key text resolves, to a database account now, and can do exactly what it could.
    const after = await can()
    expect(after.map((key) => key.scopes)).toEqual(before.map((key) => key.scopes))
    expect(after.every((key) => key.owner && key.owner !== master.orgAdminId)).toBe(true)
    expect(new Set(after.map((key) => key.owner)).size).toBe(3)
    const levels = await Promise.all(after.map(({ owner }, i) => platform((tx) => namespaceAccess(tx, org.orgId, keys[i]!.at.workspaceId, owner!))))
    expect(levels.map((access) => access && [access.accountRole, access.permission])).toEqual([['guest', 'write'], ['guest', 'read'], ['guest', 'write']])
    // Each account reaches its own database only.
    expect(await platform((tx) => namespaceAccess(tx, org.orgId, handbook.id, after[0]!.owner!))).toMatchObject({ permission: null })
    expect(await platform((tx) => namespaceAccess(tx, org.orgId, alice.id, after[2]!.owner!))).toMatchObject({ permission: null })
    const { rows: kept } = await org.db.admin.query('SELECT owner_id FROM platform.api_tokens WHERE id = $1', [revoked[0]!.id])
    expect(kept).toEqual([{ owner_id: master.orgAdminId }])

    // org-admin holds nothing, so a master key reaches no docket it did not make.
    expect(await platform((tx) => namespaceAccess(tx, org.orgId, handbook.id, master.orgAdminId))).toMatchObject({ accountRole: 'provisioner', permission: null })
    const { rows: grants } = await org.db.admin.query('SELECT 1 FROM platform.namespace_grants WHERE principal_id = $1', [master.orgAdminId])
    expect(grants).toEqual([])
    expect((await call('POST', 'databases/handbook/keys', {})).status).toBe(403)
    const fresh = await (await call('POST', 'databases/alice/keys', {})).json()
    expect((await resolver.resolveBearer(fresh.key, resource(alice.id, 'alice')))?.userId).toBe(after[0]!.owner)

    // The rollback is clean too.
    await transaction(org.db.admin, (tx) => tx.query(down0014))
    const { rows: tables } = await org.db.admin.query("SELECT to_regclass('platform.database_accounts') AS at")
    expect(tables).toEqual([{ at: null }])
    expect(await migratePlatform(org.db.admin, { appRole: org.db.appRole })).toBe(1)
  })
})
