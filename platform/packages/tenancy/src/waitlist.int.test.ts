// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TenancyError, isAllowlisted, mayEnterBeta, upsertGitHubUser, type GitHubIdentity } from './model.js'
import { tenantRouter, type TenantRouter } from './router.js'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from './testing.js'
import {
  claimWaitlistInvite,
  describeWaitlistEntry,
  inviteFromWaitlist,
  joinWaitlist,
  joinWaitlistWithGitHub,
  listWaitlist,
  waitlistEntryOf,
} from './waitlist.js'

describe.skipIf(!TEST_PG_URL)('the beta waitlist', () => {
  let db: TestDatabase
  let router: TenantRouter
  let seq = 5000

  const identity = (login: string, emails: string[] = []): GitHubIdentity => ({ id: (seq += 1), login, name: null, avatarUrl: null, emails })
  const form = (email: string, extra: Partial<Parameters<typeof joinWaitlist>[1]> = {}) => ({
    email,
    teamName: 'Platform',
    teamSize: '2-5' as const,
    note: null,
    ...extra,
  })

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('keeps one entry per email, and a second join changes nothing', async () => {
    const first = await router.withPlatform((tx) => joinWaitlist(tx, form('sam@example.test', { note: 'services first' })))
    expect(first.created).toBe(true)
    const again = await router.withPlatform((tx) => joinWaitlist(tx, form('sam@example.test', { teamName: 'Someone Else' })))
    expect(again).toEqual({ id: first.id, created: false })

    const [entry] = (await router.withPlatform((tx) => listWaitlist(tx))).filter((row) => row.id === first.id)
    expect(entry).toMatchObject({ via: 'email', teamName: 'Platform', teamSize: '2-5', note: 'services first', status: 'waiting' })
  })

  it('records a refused GitHub sign-in once per account, without admitting it', async () => {
    const pat = identity('Pat', ['pat@example.test'])
    const joined = await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, pat))
    expect(joined.created).toBe(true)
    const renamed = { ...pat, login: 'pat-renamed' }
    expect(await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, renamed))).toEqual({ id: joined.id, created: false })

    const entry = await router.withPlatform((tx) => waitlistEntryOf(tx, pat.id))
    expect(entry).toMatchObject({ via: 'github', email: 'pat@example.test', githubLogin: 'pat-renamed', githubVerified: true })
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, renamed))).toBe(false)
  })

  it("gives a form entry to the GitHub account that holds its email", async () => {
    const formed = await router.withPlatform((tx) => joinWaitlist(tx, form('kim@example.test')))
    const kim = identity('kim', ['Kim@Example.test'])
    expect(await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, kim))).toEqual({ id: formed.id, created: false })
    expect(await router.withPlatform((tx) => waitlistEntryOf(tx, kim.id))).toMatchObject({ githubLogin: 'kim', githubVerified: true, teamName: 'Platform' })
  })

  it('takes details from the invite-only page, keeping another entry’s email', async () => {
    await router.withPlatform((tx) => joinWaitlist(tx, form('taken@example.test')))
    const lee = identity('lee', [])
    await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, lee))
    await router.withPlatform((tx) =>
      describeWaitlistEntry(tx, lee.id, { email: 'taken@example.test', teamName: 'Lee & co', teamSize: '1', note: 'hi' }),
    )
    expect(await router.withPlatform((tx) => waitlistEntryOf(tx, lee.id))).toMatchObject({ email: null, teamName: 'Lee & co', teamSize: '1', note: 'hi' })
    await router.withPlatform((tx) =>
      describeWaitlistEntry(tx, lee.id, { email: 'lee@example.test', teamName: 'Lee & co', teamSize: '1', note: null }),
    )
    expect(await router.withPlatform((tx) => waitlistEntryOf(tx, lee.id))).toMatchObject({ email: 'lee@example.test' })
  })

  it('invites a GitHub entry by allowlisting its login, once', async () => {
    const admin = await router.withPlatform((tx) => upsertGitHubUser(tx, identity('captain')))
    const ana = identity('ana', ['ana@example.test'])
    const joined = await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, ana))

    const invited = await router.withPlatform((tx) => inviteFromWaitlist(tx, { id: joined.id, invitedBy: admin.id }))
    expect(invited).toMatchObject({ status: 'invited', invitedByLogin: 'captain', allowlisted: true })
    expect(await router.withPlatform((tx) => isAllowlisted(tx, ana.id))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, ana))).toBe(true)

    await expect(router.withPlatform((tx) => inviteFromWaitlist(tx, { id: joined.id, invitedBy: admin.id }))).rejects.toThrow(TenancyError)
    await expect(router.withPlatform((tx) => inviteFromWaitlist(tx, { id: 'nope', invitedBy: admin.id }))).rejects.toThrow('no longer exists')
    expect((await router.withPlatform((tx) => listWaitlist(tx, { status: 'invited' }))).map((entry) => entry.id)).toContain(joined.id)
    expect((await router.withPlatform((tx) => listWaitlist(tx, { status: 'waiting' }))).map((entry) => entry.id)).not.toContain(joined.id)
  })

  it('invites a form entry only once GitHub has verified its email, and allowlists only that login', async () => {
    const admin = await router.withPlatform((tx) => upsertGitHubUser(tx, identity('captain2')))
    const formed = await router.withPlatform((tx) => joinWaitlist(tx, form('jo@corp.test')))
    const [unverified] = (await router.withPlatform((tx) => listWaitlist(tx))).filter((row) => row.id === formed.id)
    expect(unverified).toMatchObject({ githubLogin: null, githubVerified: false })
    await expect(router.withPlatform((tx) => inviteFromWaitlist(tx, { id: formed.id, invitedBy: admin.id }))).rejects.toThrow(
      'needs a GitHub sign-in',
    )
    expect((await router.withPlatform((tx) => listWaitlist(tx, { status: 'waiting' }))).map((row) => row.id)).toContain(formed.id)

    // Someone else's sign-in does not make it theirs.
    const impostor = identity('impostor', ['other@corp.test'])
    await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, impostor))
    const jo = identity('jo-gh', ['jo@corp.test'])
    expect(await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, jo))).toEqual({ id: formed.id, created: false })

    const invited = await router.withPlatform((tx) => inviteFromWaitlist(tx, { id: formed.id, invitedBy: admin.id }))
    expect(invited).toMatchObject({ status: 'invited', githubLogin: 'jo-gh', githubVerified: true, allowlisted: true })
    expect(await router.withPlatform((tx) => isAllowlisted(tx, jo.id))).toBe(true)
    expect(await router.withPlatform((tx) => isAllowlisted(tx, impostor.id))).toBe(false)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, jo))).toBe(true)
    // The invite is the account's, not its login's.
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('jo-gh')))).toBe(false)
  })

  it('admits an invited account that signs in under a new login', async () => {
    const admin = await router.withPlatform((tx) => upsertGitHubUser(tx, identity('captain3')))
    const rob = identity('rob')
    const joined = await router.withPlatform((tx) => joinWaitlistWithGitHub(tx, rob))
    // Not before the invite, and not again for the login the invite allowlisted.
    expect(await router.withPlatform((tx) => claimWaitlistInvite(tx, { ...rob, login: 'rob2' }))).toBe(false)
    await router.withPlatform((tx) => inviteFromWaitlist(tx, { id: joined.id, invitedBy: admin.id }))
    expect(await router.withPlatform((tx) => claimWaitlistInvite(tx, rob))).toBe(false)

    // The invite admits the account, whatever its login.
    const renamed = { ...rob, login: 'Rob-Renamed' }
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, renamed))).toBe(true)
    // Another account using the new login gets nothing.
    expect(await router.withPlatform((tx) => claimWaitlistInvite(tx, identity('rob-renamed')))).toBe(false)
    expect(await router.withPlatform((tx) => claimWaitlistInvite(tx, renamed))).toBe(true)
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, renamed))).toBe(true)
    // Nor does one that takes the invited account's old login.
    expect(await router.withPlatform((tx) => mayEnterBeta(tx, identity('rob')))).toBe(false)
    expect(await router.withPlatform((tx) => waitlistEntryOf(tx, rob.id))).toMatchObject({ githubLogin: 'rob-renamed', status: 'invited' })
  })
})
