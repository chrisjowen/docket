// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accessOf, listGrants } from './access.js'
import { mayEnter } from './identity.js'
import {
  answerInvite,
  answerInviteByLink,
  createInvite,
  insertOrg,
  inviteByLink,
  inviteEmailAddress,
  isInviteLinkSecret,
  listMembers,
  markInviteEmailed,
  openInvitesOf,
  reissueInvite,
  revokeInvite,
  upsertGitHubUser,
  type GitHubIdentity,
  type User,
} from './model.js'
import { newTenantId } from './names.js'
import { ACCOUNT, docketPlace, spacePlace, type Access } from './roles.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'

// Invite links (tenancy v2 §6): an invite carries a role on a place, lasts 7 days and works once, by link and email.
describe.skipIf(!TEST_PG_URL)('invite links', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 50_000

  const identity = (login: string, emails: string[] = []): GitHubIdentity => ({ id: (seq += 1), login, name: null, avatarUrl: null, emails })
  const human = (login: string, emails: string[] = []) => router.withPlatform((tx) => upsertGitHubUser(tx, identity(login, emails)))
  async function account(owner: User) {
    const id = newTenantId()
    const slug = `o-${id}`
    await router.withPlatform((tx) => insertOrg(tx, { id, slug, name: slug, ownerId: owner.id }))
    await db.admin.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [id])
    return { id, slug }
  }
  const accessFor = async (orgId: string, user: User): Promise<Access> => (await router.withPlatform((tx) => accessOf(tx, orgId, user.id))) as Access
  const invite = async (orgId: string, owner: User, who: string, place = ACCOUNT, roleId = 'writer') =>
    router.withPlatform(async (tx) => createInvite(tx, { orgId, who, roleId, place, actorId: owner.id, actor: await accessFor(orgId, owner) }))

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('issues a link once, keeping only its hash, and opens the invite by it', async () => {
    const owner = await human('link-owner')
    const acme = await account(owner)
    const made = await invite(acme.id, owner, 'pat@example.com')
    expect(isInviteLinkSecret(made.linkSecret)).toBe(true)
    const { rows } = await db.admin.query('SELECT link_hash FROM platform.invites WHERE id = $1', [made.id])
    expect(rows[0].link_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].link_hash).not.toContain(made.linkSecret)

    const opened = await router.withPlatform((tx) => inviteByLink(tx, made.linkSecret))
    expect(opened).toMatchObject({ id: made.id, orgSlug: acme.slug, email: 'pat@example.com', roleName: 'Writer', state: 'open' })
    expect(await router.withPlatform((tx) => inviteByLink(tx, 'dki_' + 'x'.repeat(32)))).toBeNull()
    expect(await router.withPlatform((tx) => inviteByLink(tx, 'not a link'))).toBeNull()
  })

  it('lets whoever holds the link to an invite by email accept it, once, with the role on the place it gives', async () => {
    const owner = await human('email-owner')
    const acme = await account(owner)
    const docket = 'paydocket'
    const made = await invite(acme.id, owner, 'pat@corp.example', docketPlace(docket), 'reader')
    // GitHub does not know pat by that address: the link is how it was proved.
    const pat = await human('pat-on-github', ['pat@personal.example'])
    expect(await router.withPlatform((tx) => answerInvite(tx, { inviteId: made.id, user: pat, accept: true })).catch((error) => error.code)).toBe('not-found')
    const joined = await router.withPlatform((tx) => answerInviteByLink(tx, { secret: made.linkSecret, user: pat, accept: true }))
    expect(joined.orgId).toBe(acme.id)
    expect((await router.withPlatform((tx) => listMembers(tx, acme.id))).map((member) => member.login)).toContain('pat-on-github')
    const grants = await router.withPlatform((tx) => listGrants(tx, acme.id, { userId: pat.id }))
    expect(grants.map((grant) => [grant.place, grant.role.id])).toEqual([[docketPlace(docket), 'reader']])

    // It works once.
    const other = await human('someone-else')
    await expect(router.withPlatform((tx) => answerInviteByLink(tx, { secret: made.linkSecret, user: other, accept: true }))).rejects.toMatchObject({ code: 'not-found' })
    expect((await router.withPlatform((tx) => inviteByLink(tx, made.linkSecret)))?.state).toBe('accepted')
  })

  it('keeps an invite to a GitHub login to that login, link or not', async () => {
    const owner = await human('login-owner')
    const acme = await account(owner)
    const made = await invite(acme.id, owner, '@Rae', spacePlace('general'))
    const intruder = await human('intruder')
    await expect(router.withPlatform((tx) => answerInviteByLink(tx, { secret: made.linkSecret, user: intruder, accept: true }))).rejects.toMatchObject({
      code: 'forbidden',
      message: 'This invite is for @rae. Sign in as them to accept it.',
    })
    const rae = await human('rae')
    await router.withPlatform((tx) => answerInviteByLink(tx, { secret: made.linkSecret, user: rae, accept: false }))
    expect((await router.withPlatform((tx) => inviteByLink(tx, made.linkSecret)))?.state).toBe('declined')
    expect((await router.withPlatform((tx) => listMembers(tx, acme.id))).map((member) => member.login)).not.toContain('rae')
  })

  it('lets a link holder sign in: any identity for an invite by email, only its login for one to a login', async () => {
    const owner = await human('enter-owner')
    const acme = await account(owner)
    const byEmail = await invite(acme.id, owner, 'new@corp.example')
    const byLogin = await invite(acme.id, owner, 'quinn')
    const stranger = identity('stranger-with-link')
    const enter = (who: GitHubIdentity, inviteLink: string | null = null) => router.withPlatform((tx) => mayEnter(tx, { provider: 'github', github: who }, { inviteLink }))
    expect(await enter(stranger)).toBe(false)
    expect(await enter(stranger, byEmail.linkSecret)).toBe(true)
    expect(await enter(stranger, byLogin.linkSecret)).toBe(false)
    expect(await enter(identity('quinn'), byLogin.linkSecret)).toBe(true)
    expect(await enter(stranger, 'dki_' + 'y'.repeat(32))).toBe(false)
    // A link to a used, cancelled or expired invite lets no one in.
    await router.withPlatform(async (tx) => revokeInvite(tx, { orgId: acme.id, inviteId: byEmail.id, actor: await accessFor(acme.id, owner) }))
    expect(await enter(stranger, byEmail.linkSecret)).toBe(false)
    expect((await router.withPlatform((tx) => inviteByLink(tx, byEmail.linkSecret)))?.state).toBe('cancelled')
  })

  it('sends an invite again with a new link for 7 more days, and the old link stops working', async () => {
    const owner = await human('again-owner')
    const acme = await account(owner)
    const made = await invite(acme.id, owner, 'sam@example.com')
    await router.withPlatform((tx) => markInviteEmailed(tx, { inviteId: made.id, to: 'Sam@Example.com' }))
    expect((await router.withPlatform((tx) => openInvitesOf(tx, acme.id)))[0]).toMatchObject({ emailedTo: 'sam@example.com' })
    await db.admin.query("UPDATE platform.invites SET expires_at = now() + interval '1 day' WHERE id = $1", [made.id])

    const again = await router.withPlatform(async (tx) => reissueInvite(tx, { orgId: acme.id, inviteId: made.id, actor: await accessFor(acme.id, owner) }))
    expect(again.id).toBe(made.id)
    expect(again.linkSecret).not.toBe(made.linkSecret)
    expect(again.emailedTo).toBeNull()
    expect(again.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000)
    expect(await router.withPlatform((tx) => inviteByLink(tx, made.linkSecret))).toBeNull()
    expect((await router.withPlatform((tx) => inviteByLink(tx, again.linkSecret)))?.state).toBe('open')

    // Only whoever may give what it gives, where it gives it, may send it again.
    const writer = await human('again-writer')
    const writerInvite = await invite(acme.id, owner, 'again-writer')
    await router.withPlatform((tx) => answerInvite(tx, { inviteId: writerInvite.id, user: writer, accept: true }))
    await expect(router.withPlatform(async (tx) => reissueInvite(tx, { orgId: acme.id, inviteId: made.id, actor: await accessFor(acme.id, writer) }))).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('treats an expired invite as expired by its link', async () => {
    const owner = await human('expired-owner')
    const acme = await account(owner)
    const made = await invite(acme.id, owner, 'late@example.com')
    await db.admin.query("UPDATE platform.invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [made.id])
    expect((await router.withPlatform((tx) => inviteByLink(tx, made.linkSecret)))?.state).toBe('expired')
    const late = await human('late')
    await expect(router.withPlatform((tx) => answerInviteByLink(tx, { secret: made.linkSecret, user: late, accept: true }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('emails an invite to its address, or to the address of a login that signed in here before', async () => {
    const owner = await human('mail-owner')
    const acme = await account(owner)
    await human('known-login', ['known@example.com'])
    const toAddress = await invite(acme.id, owner, 'addr@example.com')
    const toKnown = await invite(acme.id, owner, 'known-login')
    const toUnknown = await invite(acme.id, owner, 'never-seen')
    expect(await router.withPlatform((tx) => inviteEmailAddress(tx, toAddress))).toBe('addr@example.com')
    expect(await router.withPlatform((tx) => inviteEmailAddress(tx, toKnown))).toBe('known@example.com')
    expect(await router.withPlatform((tx) => inviteEmailAddress(tx, toUnknown))).toBeNull()
  })
})
