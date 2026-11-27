// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LIMITS } from './limits.js'
import { lookupMasterKey } from './master-key.js'
import { changeRole, createInvite, databaseAccount, insertOrg, listMasterKeys, listMembers, mintMasterKey, namespaceAccess, removeMember, revokeMasterKeys, setAccountable, upsertGitHubUser } from './model.js'
import { newTenantId } from './names.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

describe.skipIf(!TEST_PG_URL)('the org admin master key', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  async function org() {
    const owner = await router.withPlatform((tx) =>
      upsertGitHubUser(tx, { id: 1, login: 'adminowner', name: null, avatarUrl: null, emails: [] }),
    )
    const id = newTenantId()
    await router.withPlatform((tx) => insertOrg(tx, { id, slug: `o-${id}`, name: 'Acme', ownerId: owner.id }))
    // What the provisioner does once the org's stores exist.
    await db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    return { owner, acme: { id } }
  }

  it('provisions the org-admin service account at the first master-key mint, without a seat, and keeps member management off it', async () => {
    const { owner, acme } = await org()
    const first = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    expect(first.key).toMatch(/^dmk_[0-9A-Za-z]{43}$/)
    expect(first.prefix).toBe(first.key.slice(0, 12))
    expect(first.databaseLimit).toBe(1000)
    const second = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id, databaseLimit: 50 }))
    expect(second.orgAdminId).toBe(first.orgAdminId)
    expect(second.databaseLimit).toBe(50)

    const members = await router.withPlatform((tx) => listMembers(tx, acme.id))
    expect(members.filter((m) => m.kind === 'service')).toEqual([
      expect.objectContaining({ id: first.orgAdminId, login: 'org-admin', role: 'editor' }),
    ])
    // A provisioner: it holds no grant, so it reaches no database, whatever its role says.
    expect(await router.withPlatform((tx) => namespaceAccess(tx, acme.id, 'anyworkspace', first.orgAdminId))).toEqual({ role: 'editor', accountRole: 'provisioner', permission: null })
    const { rows } = await db.admin.query<{ key_hash: string }>('SELECT key_hash FROM platform.org_master_keys WHERE org_id = $1', [acme.id])
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.key_hash)).not.toContain(first.key)

    await expect(
      router.withPlatform((tx) => removeMember(tx, { orgId: acme.id, userId: first.orgAdminId, actorRole: 'owner' })),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('Docket Cloud operators') })
    await expect(
      router.withPlatform((tx) => changeRole(tx, { orgId: acme.id, userId: first.orgAdminId, role: 'viewer', actorRole: 'owner' })),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await router.withPlatform((tx) => listMembers(tx, acme.id))).toContainEqual(
      expect.objectContaining({ id: first.orgAdminId, role: 'editor' }),
    )

    // The owner and every invite fill the seats; the org-admin account takes none.
    for (let i = 1; i < LIMITS.membersPerOrg; i += 1) {
      await router.withPlatform((tx) =>
        createInvite(tx, { orgId: acme.id, who: `seat${i}`, role: 'viewer', actorId: owner.id, actorRole: 'owner' }),
      )
    }
    await expect(
      router.withPlatform((tx) =>
        createInvite(tx, { orgId: acme.id, who: 'onemore', role: 'viewer', actorId: owner.id, actorRole: 'owner' }),
      ),
    ).rejects.toMatchObject({ code: 'limit' })
  })

  /** An access key the org admin API issued: a row owned by `ownerId` (a database account, or org-admin before platform 0014), as `issueApiToken` writes it. */
  async function accessKey(orgId: string, ownerId: string): Promise<string> {
    const id = `tok_${randomBytes(6).toString('hex')}`
    await db.admin.query(
      `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, workspace_id, owner_id, scopes, created_by, expires_at)
       VALUES ($1, $2, 'dkt_live_x', $3, 'ws', $4, ARRAY['docket:read'], $4, now() + interval '1 day')`,
      [id, randomBytes(32).toString('hex'), orgId, ownerId],
    )
    return id
  }

  it('gives each database a read and a write account, granted that database alone, that member management leaves alone', async () => {
    const { owner, acme } = await org()
    const minted = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const account = (workspaceId: string, permission: 'read' | 'write') =>
      router.withPlatform((tx) => databaseAccount(tx, { orgId: acme.id, workspaceId, permission }))
    const reader = await account('alicedb', 'read')
    const writer = await account('alicedb', 'write')
    expect(writer).not.toBe(reader)
    expect(await account('alicedb', 'read')).toBe(reader)
    expect(await account('bobdb', 'read')).not.toBe(reader)

    const access = (workspaceId: string, userId: string) => router.withPlatform((tx) => namespaceAccess(tx, acme.id, workspaceId, userId))
    expect(await access('alicedb', reader)).toEqual({ role: 'viewer', accountRole: 'guest', permission: 'read' })
    expect(await access('alicedb', writer)).toEqual({ role: 'editor', accountRole: 'guest', permission: 'write' })
    expect(await access('bobdb', writer)).toMatchObject({ permission: null })
    const { rows: users } = await db.admin.query<{ login: string; created_by: string }>('SELECT login, created_by FROM platform.users WHERE id = $1', [writer])
    expect(users).toEqual([{ login: 'org-admin/alicedb/write', created_by: minted.orgAdminId }])
    await expect(router.withPlatform((tx) => databaseAccount(tx, { orgId: acme.id, workspaceId: 'alicedb', permission: 'admin' as 'read' }))).rejects.toMatchObject({ code: '22023' })

    // Not members: never listed, never changed, removed or reassigned, and no seat taken.
    expect((await router.withPlatform((tx) => listMembers(tx, acme.id))).map((member) => member.id)).not.toContain(writer)
    for (const change of [
      () => router.withPlatform((tx) => changeRole(tx, { orgId: acme.id, userId: writer, role: 'admin', actorRole: 'owner' })),
      () => router.withPlatform((tx) => removeMember(tx, { orgId: acme.id, userId: writer, actorRole: 'owner' })),
      () => router.withPlatform((tx) => setAccountable(tx, { orgId: acme.id, serviceId: writer, accountableLogin: 'adminowner' })),
    ]) {
      await expect(change()).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('org admin API') })
    }
    for (let i = 1; i < LIMITS.membersPerOrg; i += 1) {
      await router.withPlatform((tx) => createInvite(tx, { orgId: acme.id, who: `db-seat${i}`, role: 'viewer', actorId: owner.id, actorRole: 'owner' }))
    }
    await expect(
      router.withPlatform((tx) => createInvite(tx, { orgId: acme.id, who: 'db-onemore', role: 'viewer', actorId: owner.id, actorRole: 'owner' })),
    ).rejects.toMatchObject({ code: 'limit' })
  })

  const revokedAt = async (tokenId: string) =>
    (await db.admin.query<{ revoked_at: Date | null; revoked_by: string | null }>('SELECT revoked_at, revoked_by FROM platform.api_tokens WHERE id = $1', [tokenId])).rows[0]

  it('lists master keys newest first, as metadata only', async () => {
    const { acme } = await org()
    expect(await router.withPlatform((tx) => listMasterKeys(tx, acme.id))).toEqual([])
    const first = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const second = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id, ttlDays: 30 }))
    const keys = await router.withPlatform((tx) => listMasterKeys(tx, acme.id))
    expect(keys.map((key) => key.id)).toEqual([second.id, first.id])
    expect(keys[0]).toEqual({ id: second.id, prefix: second.prefix, createdAt: second.createdAt, expiresAt: second.expiresAt, revokedAt: null, lastUsedAt: null })
    expect(JSON.stringify(keys)).not.toContain(first.key.slice(12))
  })

  it('revokes one master key at once and keeps org-admin while another is live', async () => {
    const { acme } = await org()
    const kept = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const gone = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const token = await accessKey(acme.id, gone.orgAdminId)

    const result = await router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, keyId: gone.id, by: 'system:operator:test' }))
    expect(result).toEqual({ revoked: [{ id: gone.id, prefix: gone.prefix }], retired: false, accessKeys: 0 })
    expect(await router.withPlatform((tx) => lookupMasterKey(tx, gone.key))).toBeNull()
    expect(await router.withPlatform((tx) => lookupMasterKey(tx, kept.key))).toMatchObject({ id: kept.id })
    expect((await revokedAt(token))?.revoked_at).toBeNull()

    // Already revoked, or another org's key: nothing to revoke here.
    await expect(router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, keyId: gone.id, by: 'system:operator:test' }))).rejects.toMatchObject({ code: 'not-found' })
    const { acme: other } = await org()
    const theirs = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: other.id }))
    await expect(router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, keyId: theirs.id, by: 'system:operator:test' }))).rejects.toMatchObject({ code: 'not-found' })
    expect(await router.withPlatform((tx) => lookupMasterKey(tx, theirs.key))).toMatchObject({ id: theirs.id })
  })

  it('retires org-admin with the last live master key, revoking every access key the API issued', async () => {
    const { owner, acme } = await org()
    const first = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const second = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    const reader = await router.withPlatform((tx) => databaseAccount(tx, { orgId: acme.id, workspaceId: 'ws', permission: 'read' }))
    const writer = await router.withPlatform((tx) => databaseAccount(tx, { orgId: acme.id, workspaceId: 'ws', permission: 'write' }))
    // Keys of the database accounts, and one org-admin still owns from before platform 0014.
    const tokens = [await accessKey(acme.id, reader), await accessKey(acme.id, writer), await accessKey(acme.id, first.orgAdminId)]
    const members = await accessKey(acme.id, owner.id)

    const result = await router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, by: 'system:operator:test' }))
    expect(result.revoked.map((key) => key.id).sort()).toEqual([first.id, second.id].sort())
    expect(result).toMatchObject({ retired: true, accessKeys: 3 })
    for (const token of tokens) expect(await revokedAt(token)).toMatchObject({ revoked_at: expect.any(Date), revoked_by: 'system:operator:test' })
    expect((await revokedAt(members))?.revoked_at).toBeNull()
    expect(await router.withPlatform((tx) => lookupMasterKey(tx, first.key))).toBeNull()

    // Revoking all again is a no-op; a later mint reuses the retired account.
    expect(await router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, by: 'system:operator:test' }))).toEqual({ revoked: [], retired: true, accessKeys: 0 })
    const again = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    expect(again.orgAdminId).toBe(first.orgAdminId)
  })

  it('revokes the last key of a suspended org, and of an org that never minted, nothing', async () => {
    const { acme } = await org()
    const key = await router.withPlatform((tx) => mintMasterKey(tx, { orgId: acme.id }))
    await db.admin.query("UPDATE platform.orgs SET status = 'suspended' WHERE id = $1", [acme.id])
    expect(await router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: acme.id, keyId: key.id, by: 'system:operator:test' }))).toMatchObject({ retired: true })
    const { acme: fresh } = await org()
    expect(await router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: fresh.id, by: 'system:operator:test' }))).toEqual({ revoked: [], retired: false, accessKeys: 0 })
    await expect(router.withPlatform((tx) => revokeMasterKeys(tx, { orgId: 'nosuch', by: 'system:operator:test' }))).rejects.toMatchObject({ code: 'not-found' })
  })
})
