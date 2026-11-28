// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accessOf } from './access.js'
import { LIMITS } from './limits.js'
import { createInvite, insertOrg, membershipBySlug, upsertGitHubUser, type User } from './model.js'
import { newTenantId } from './names.js'
import { DEFAULT_ACCOUNT_LIMITS, accountLimits, operatorAccount, operatorAccounts, setAccountLimits, setAccountSuspended } from './operator.js'
import { ACCOUNT, type Access } from './roles.js'
import { OrgUnavailable, tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

// The operator console (tenancy v2 §3.5, phase 6.3): every account, suspend and resume, and an account's own limits.
describe.skipIf(!TEST_PG_URL)('the operator console', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 90_000

  const human = (login: string) => router.withPlatform((tx) => upsertGitHubUser(tx, { id: (seq += 1), login, name: null, avatarUrl: null, emails: [] }))
  async function account(owner: User, status: 'active' | 'provisioning' = 'active') {
    const id = newTenantId()
    const slug = `op-${id}`
    await router.withPlatform((tx) => insertOrg(tx, { id, slug, name: `Account ${id}`, ownerId: owner.id, maxOrgs: 1000 }))
    if (status === 'active') await db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    return { id, slug }
  }
  const accessFor = async (orgId: string, user: User): Promise<Access> => (await router.withPlatform((tx) => accessOf(tx, orgId, user.id))) as Access

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it("lists every account with its owners, people, system accounts, open invites and limits, and nothing of its content", async () => {
    const owner = await human('op-owner')
    const acme = await account(owner)
    await router.withPlatform(async (tx) => createInvite(tx, { orgId: acme.id, who: 'someone', roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }))
    const listed = (await router.withPlatform(operatorAccounts)).find((each) => each.id === acme.id)
    expect(listed).toEqual({
      id: acme.id,
      slug: acme.slug,
      name: `Account ${acme.id}`,
      status: 'active',
      createdAt: expect.any(Date),
      owners: ['op-owner'],
      people: 1,
      systemAccounts: 0,
      openInvites: 1,
      limits: { maxMembers: null, maxDockets: null },
      suspended: null,
    })
    expect(await router.withPlatform((tx) => operatorAccount(tx, 'no-such-account'))).toBeNull()
  })

  it('suspends an account so that nothing in it is served, and resumes it as it was', async () => {
    const owner = await human('op-suspended')
    const operator = await human('op-operator')
    const acme = await account(owner)
    expect(await router.withPlatform((tx) => setAccountSuspended(tx, { orgId: acme.id, suspended: true, reason: 'Unpaid invoice', by: operator.id }))).toBe('active')
    expect(await router.withPlatform((tx) => operatorAccount(tx, acme.slug))).toMatchObject({
      status: 'suspended',
      suspended: { at: expect.any(Date), by: 'op-operator', reason: 'Unpaid invoice' },
    })
    // Its members no longer reach it, and nothing runs as it.
    expect(await router.withPlatform((tx) => membershipBySlug(tx, acme.slug, owner.id))).toBeNull()
    await expect(router.withTenant(acme.id, async () => 'served')).rejects.toThrow(new OrgUnavailable(acme.id, 'inactive'))
    // Suspending again changes nothing.
    expect(await router.withPlatform((tx) => setAccountSuspended(tx, { orgId: acme.id, suspended: true, by: operator.id }))).toBe('suspended')

    expect(await router.withPlatform((tx) => setAccountSuspended(tx, { orgId: acme.id, suspended: false, by: operator.id }))).toBe('suspended')
    expect(await router.withPlatform((tx) => operatorAccount(tx, acme.slug))).toMatchObject({ status: 'active', suspended: null })
    expect(await router.withPlatform((tx) => membershipBySlug(tx, acme.slug, owner.id))).not.toBeNull()
  })

  it('refuses to suspend an account still being set up, or one that does not exist', async () => {
    const owner = await human('op-provisioning')
    const pending = await account(owner, 'provisioning')
    await expect(router.withPlatform((tx) => setAccountSuspended(tx, { orgId: pending.id, suspended: true, by: owner.id }))).rejects.toMatchObject({ code: 'conflict' })
    await expect(router.withPlatform((tx) => setAccountSuspended(tx, { orgId: 'nosuch', suspended: true, by: owner.id }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it("sets an account's own seat and docket limits, and holds new invites to its seats", async () => {
    const owner = await human('op-limits')
    const acme = await account(owner)
    expect(await router.withPlatform((tx) => accountLimits(tx, acme.id))).toEqual({ maxMembers: LIMITS.membersPerOrg, maxDockets: LIMITS.workspacesPerOrg })
    expect(DEFAULT_ACCOUNT_LIMITS).toEqual({ maxMembers: LIMITS.membersPerOrg, maxDockets: LIMITS.workspacesPerOrg })

    expect(await router.withPlatform((tx) => setAccountLimits(tx, { orgId: acme.id, maxMembers: 2, maxDockets: 12 }))).toEqual({ maxMembers: 2, maxDockets: 12 })
    // A limit left out stays; null puts the beta's back.
    expect(await router.withPlatform((tx) => setAccountLimits(tx, { orgId: acme.id, maxDockets: null }))).toEqual({ maxMembers: 2, maxDockets: null })
    expect(await router.withPlatform((tx) => accountLimits(tx, acme.id))).toEqual({ maxMembers: 2, maxDockets: LIMITS.workspacesPerOrg })
    await expect(router.withPlatform((tx) => setAccountLimits(tx, { orgId: acme.id, maxMembers: 0 }))).rejects.toMatchObject({ code: 'invalid' })
    await expect(router.withPlatform((tx) => setAccountLimits(tx, { orgId: acme.id, maxMembers: 1.5 }))).rejects.toMatchObject({ code: 'invalid' })

    // The owner takes one seat of two: one invite fits, a second does not.
    const invite = async (who: string) =>
      router.withPlatform(async (tx) => createInvite(tx, { orgId: acme.id, who, roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }))
    await invite('first-seat')
    await expect(invite('second-seat')).rejects.toMatchObject({ code: 'limit', message: 'This account holds at most 2 members and invites.' })
    await router.withPlatform((tx) => setAccountLimits(tx, { orgId: acme.id, maxMembers: null }))
    await invite('second-seat')
  })
})
