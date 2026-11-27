// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LIMITS, PROVISIONING_TIMEOUT_MS } from './limits.js'
import {
  TenancyError,
  answerInvite,
  countLiveOrgs,
  createInvite,
  createServiceAccount,
  insertOrg,
  isAllowlisted,
  listMembers,
  mayEnterBeta,
  membershipBySlug,
  openInvitesFor,
  removeMember,
  describeServiceAccount,
  listSystemAccounts,
  allowlist,
  upsertGitHubUser,
  type GitHubIdentity,
  type User,
} from './model.js'
import { accessOf, listGrants, setGrant, setOwner } from './access.js'
import { newTenantId } from './names.js'
import { ACCOUNT, docketPlace, type Access } from './roles.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

describe.skipIf(!TEST_PG_URL)('the tenancy model', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 1000

  const identity = (login: string, emails: string[] = []): GitHubIdentity => ({
    id: (seq += 1),
    login,
    name: null,
    avatarUrl: null,
    emails,
  })
  const human = (login: string, emails: string[] = []) =>
    router.withPlatform((tx) => upsertGitHubUser(tx, identity(login, emails)))
  async function org(owner: User, slug = `o-${newTenantId()}`) {
    const id = newTenantId()
    await router.withPlatform((tx) => insertOrg(tx, { id, slug, name: slug, ownerId: owner.id }))
    // What the provisioner does once the org's stores exist.
    await db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    return { id, slug }
  }

  /** The member's access now, as a request reads it. */
  const accessFor = async (orgId: string, user: User): Promise<Access> =>
    (await router.withPlatform((tx) => accessOf(tx, orgId, user.id))) as Access

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('admits allowlisted logins and holders of an open invite only', async () => {
    const owner = await human('owner1')
    const acme = await org(owner)
    await router.withPlatform((tx) => allowlist(tx, ['Listed']))
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('listed')))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('stranger')))).toBe(false)

    await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: '@Invitee', roleId: 'writer', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }),
    )
    await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: 'Ops@Acme.dev', roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }),
    )
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('invitee')))).toBe(true)
    // An email invite matches a verified email, whatever the login.
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('someone', ['ops@acme.dev'])))).toBe(true)
  })

  it('ties an allowlisted login to the first account that signs in as it, so a renamed login admits no one else', async () => {
    await router.withPlatform((tx) => allowlist(tx, ['Kept']))
    const kept = identity('kept')
    expect(await router.withPlatform((tx) => isAllowlisted(tx, kept.id))).toBe(false)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, kept))).toBe(true)
    expect(await router.withPlatform((tx) => isAllowlisted(tx, kept.id))).toBe(true)

    // The account renames: it still gets in, and whoever registers the old login does not,
    // even once the deploy seeds the same login again.
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, { ...kept, login: 'kept-renamed' }))).toBe(true)
    const squatter = identity('kept')
    await router.withPlatform((tx) => allowlist(tx, ['kept']))
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, squatter))).toBe(false)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, kept))).toBe(true)
  })

  it('makes an invite single use, and an expired one admits no one', async () => {
    const owner = await human('owner2')
    const acme = await org(owner)
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: 'late', roleId: 'writer', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner), now: past }),
    )
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('late')))).toBe(false)
    // A fresh invite replaces the expired one.
    const fresh = await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: 'late', roleId: 'writer', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }),
    )

    const late = await human('late')
    const accepted = await router.withPlatform((tx) => answerInvite(tx, { inviteId: fresh.id, user: late, accept: true }))
    expect(accepted.orgId).toBe(acme.id)
    expect(await router.withPlatform((tx) => membershipBySlug(tx, acme.slug, late.id))).toMatchObject({ owner: false, guest: false })
    const [given] = await router.withPlatform((tx) => listGrants(tx, acme.id, { userId: late.id }))
    expect(given).toMatchObject({ place: ACCOUNT, role: { id: 'writer' }, grantedByLogin: 'owner2' })
    await expect(
      router.withPlatform((tx) => answerInvite(tx, { inviteId: fresh.id, user: late, accept: true })),
    ).rejects.toThrow(TenancyError)
    expect(await router.withPlatform((tx) => openInvitesFor(tx, late))).toEqual([])
  })

  it('lets a member who joined by invite sign in again once the invite is used, until removed', async () => {
    const owner = await human('owner7')
    const acme = await org(owner)
    const bob = identity('bob7')
    const invite = await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: 'bob7', roleId: 'writer', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }),
    )
    const user = await router.withPlatform((tx) => upsertGitHubUser(tx, bob))
    await router.withPlatform((tx) => answerInvite(tx, { inviteId: invite.id, user, accept: true }))

    // Signed out, or the session expired: the invite is spent, the membership admits him.
    expect(await router.withPlatform((tx) => openInvitesFor(tx, bob))).toEqual([])
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, bob))).toBe(true)

    const ownerAccess = await accessFor(acme.id, owner)
    await router.withPlatform((tx) => removeMember(tx, { orgId: acme.id, userId: user.id, actor: ownerAccess }))
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, bob))).toBe(false)
  })

  it('reaps an org stuck provisioning past the timeout, freeing its slot and slug', async () => {
    const owner = await human('owner8')
    const id = newTenantId()
    const slug = `stuck-${id}`
    await router.withPlatform((tx) => insertOrg(tx, { id, slug, name: slug, ownerId: owner.id }))
    const before = await router.withPlatform(countLiveOrgs)
    await db.admin.query('UPDATE platform.orgs SET created_at = now() - make_interval(secs => $2) WHERE id = $1', [
      id,
      PROVISIONING_TIMEOUT_MS / 1000 + 60,
    ])
    expect(await router.withPlatform(countLiveOrgs)).toBe(before - 1)

    const again = newTenantId()
    await router.withPlatform((tx) => insertOrg(tx, { id: again, slug, name: slug, ownerId: owner.id }))
    const { rows } = await db.admin.query<{ id: string }>('SELECT id FROM platform.orgs WHERE slug = $1', [slug])
    expect(rows).toEqual([{ id: again }])
    await db.admin.query('DELETE FROM platform.orgs WHERE id = $1', [again])
  })

  it('refuses an invite for a member, a duplicate, and someone else’s invite', async () => {
    const owner = await human('owner3')
    const acme = await org(owner)
    const actor = await accessFor(acme.id, owner)
    const invite = (who: string) =>
      router.withPlatform((tx) => createInvite(tx, { orgId: acme.id, who, roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor }))
    await expect(invite('owner3')).rejects.toMatchObject({ code: 'conflict' })
    const first = await invite('twice')
    await expect(invite('@TWICE')).rejects.toMatchObject({ code: 'conflict' })
    await expect(invite('not a login!')).rejects.toMatchObject({ code: 'invalid' })
    const intruder = await human('intruder')
    await expect(
      router.withPlatform((tx) => answerInvite(tx, { inviteId: first.id, user: intruder, accept: true })),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('keeps an owner, and keeps admins away from owners', async () => {
    const owner = await human('owner4')
    const acme = await org(owner)
    const admin = await human('admin4')
    const inv = await router.withPlatform(async (tx) =>
      createInvite(tx, { orgId: acme.id, who: 'admin4', roleId: 'admin', place: ACCOUNT, actorId: owner.id, actor: await accessFor(acme.id, owner) }),
    )
    await router.withPlatform((tx) => answerInvite(tx, { inviteId: inv.id, user: admin, accept: true }))
    const asOwner = await accessFor(acme.id, owner)
    const asAdmin = await accessFor(acme.id, admin)

    await expect(
      router.withPlatform((tx) => setOwner(tx, { orgId: acme.id, userId: owner.id, owner: false, actor: asOwner })),
    ).rejects.toMatchObject({ code: 'last-owner' })
    await expect(
      router.withPlatform((tx) => removeMember(tx, { orgId: acme.id, userId: owner.id, actor: asOwner })),
    ).rejects.toMatchObject({ code: 'last-owner' })
    await expect(
      router.withPlatform((tx) => removeMember(tx, { orgId: acme.id, userId: owner.id, actor: asAdmin })),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      router.withPlatform((tx) => setOwner(tx, { orgId: acme.id, userId: admin.id, owner: true, actor: asAdmin })),
    ).rejects.toMatchObject({ code: 'forbidden' })

    // Ownership moves only through an owner, and then the old owner may step down.
    await router.withPlatform((tx) => setOwner(tx, { orgId: acme.id, userId: admin.id, owner: true, actor: asOwner }))
    await router.withPlatform((tx) => setOwner(tx, { orgId: acme.id, userId: owner.id, owner: false, actor: asOwner }))
    const owners = Object.fromEntries((await router.withPlatform((tx) => listMembers(tx, acme.id))).map((m) => [m.login, m.owner]))
    expect(owners).toEqual({ admin4: true, owner4: false })
  })

  it('holds an org to the members limit, counting service accounts and open invites', async () => {
    const owner = await human('owner5')
    const acme = await org(owner)
    const ownerAccess = await accessFor(acme.id, owner)
    for (let i = 1; i < LIMITS.membersPerOrg - 1; i += 1) {
      await router.withPlatform((tx) =>
        createInvite(tx, { orgId: acme.id, who: `seat${i}`, roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: ownerAccess }),
      )
    }
    await router.withPlatform((tx) =>
      createServiceAccount(tx, { orgId: acme.id, name: 'ci-bot', description: null, actorId: owner.id, actor: ownerAccess }),
    )
    await expect(
      router.withPlatform((tx) =>
        createInvite(tx, { orgId: acme.id, who: 'onemore', roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: ownerAccess }),
      ),
    ).rejects.toMatchObject({ code: 'limit' })
  })

  it('never lets a system account become owner, and gives it access only by a grant', async () => {
    const owner = await human('owner10')
    const acme = await org(owner)
    const ownerAccess = await accessFor(acme.id, owner)
    const bot = await router.withPlatform((tx) =>
      createServiceAccount(tx, { orgId: acme.id, name: 'ci-bot', description: null, actorId: owner.id, actor: ownerAccess }),
    )
    await expect(
      router.withPlatform((tx) => setOwner(tx, { orgId: acme.id, userId: bot.id, owner: true, actor: ownerAccess })),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect((await accessFor(acme.id, bot as User)).grants).toEqual([])
    await router.withPlatform((tx) =>
      setGrant(tx, { orgId: acme.id, who: { kind: 'user', id: bot.id }, place: docketPlace('abc'), roleId: 'writer', actor: ownerAccess, actorId: owner.id }),
    )
    expect((await accessFor(acme.id, bot as User)).grants.map((grant) => grant.role.id)).toEqual(['writer'])
    // Its seat in the beta goes back for the next test.
    await db.admin.query("UPDATE platform.orgs SET status = 'deleted' WHERE id = $1", [acme.id])
  })

  it('makes a system account owned by the account, with no person acting for it, and lists it with its tokens', async () => {
    const owner = await human('owner9')
    const acme = await org(owner)
    const ownerAccess = await accessFor(acme.id, owner)
    const bot = await router.withPlatform((tx) =>
      createServiceAccount(tx, { orgId: acme.id, name: 'ci-bot', description: 'CI', actorId: owner.id, actor: ownerAccess }),
    )
    const { rows } = await db.admin.query<{ accountable_user_id: string | null; created_by: string }>(
      'SELECT accountable_user_id, created_by FROM platform.users WHERE id = $1',
      [bot.id],
    )
    expect(rows).toEqual([{ accountable_user_id: null, created_by: owner.id }])
    const [listed] = await router.withPlatform((tx) => listSystemAccounts(tx, acme.id))
    expect(listed).toMatchObject({ id: bot.id, name: 'ci-bot', description: 'CI', createdByLogin: 'owner9', managed: false, liveTokens: 0, nextExpiry: null })
    await router.withPlatform((tx) => describeServiceAccount(tx, { orgId: acme.id, serviceId: bot.id, description: 'Nightly sync' }))
    expect((await router.withPlatform((tx) => listSystemAccounts(tx, acme.id)))[0]?.description).toBe('Nightly sync')
    // A person is not a system account.
    await expect(router.withPlatform((tx) => describeServiceAccount(tx, { orgId: acme.id, serviceId: owner.id, description: 'x' }))).rejects.toMatchObject({
      code: 'not-found',
    })
    // Its seat in the beta goes back for the next test.
    await db.admin.query("UPDATE platform.orgs SET status = 'deleted' WHERE id = $1", [acme.id])
  })

  it('holds the beta to its org limit and refuses a taken slug', async () => {
    const owner = await human('owner6')
    const taken = await org(owner)
    await expect(org(owner, taken.slug)).rejects.toMatchObject({ code: 'conflict' })
    const { rows } = await db.admin.query<{ count: string }>("SELECT count(*) FROM platform.orgs WHERE status <> 'deleted'")
    for (let i = Number(rows[0]?.count); i < LIMITS.orgs; i += 1) await org(owner)
    await expect(org(owner)).rejects.toMatchObject({ code: 'limit' })
  })
})
