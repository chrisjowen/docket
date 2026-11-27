// SPDX-License-Identifier: AGPL-3.0-only
import {
  ACCOUNT,
  GITHUB_ISSUER,
  accessOf,
  createInvite,
  identitiesOf,
  insertOrg,
  isUserAllowlisted,
  mayEnter,
  newTenantId,
  replaceSigninAllowlist,
  resolveIdentity,
  tenantRouter,
  upsertGitHubUser,
  type ExternalIdentity,
  type TenantRouter,
} from '@docket/platform-tenancy'
import { TEST_PG_URL, createTestDatabase, type TestDatabase } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { passwordSignIn, syncPasswordUsers } from './password.js'

const ISSUER = 'https://idp.example.com'
type OidcIdentity = Extract<ExternalIdentity, { issuer: string }>
const oidc = (subject: string, extra: Partial<OidcIdentity> = {}): OidcIdentity => ({
  provider: 'oidc',
  issuer: ISSUER,
  subject,
  login: 'jo.okta',
  name: 'Jo Bloggs',
  avatarUrl: null,
  emails: ['jo@example.com'],
  ...extra,
})

describe.skipIf(!TEST_PG_URL)('one identity resolver for every provider', () => {
  let db: TestDatabase
  let router: TenantRouter

  beforeAll(async () => {
    db = await createTestDatabase()
    router = tenantRouter(db.app)
  })
  afterAll(() => db?.drop())

  it('gives an existing GitHub user their GitHub identity, and keeps resolving them by GitHub id', async () => {
    const before = await router.withPlatform((tx) => upsertGitHubUser(tx, { id: 501, login: 'ada', name: null, avatarUrl: null, emails: [] }))
    const resolved = await router.withPlatform((tx) => resolveIdentity(tx, { provider: 'github', github: { id: 501, login: 'ada-renamed', name: 'Ada', avatarUrl: null, emails: ['ada@example.com'] } }))
    expect(resolved).toMatchObject({ id: before.id, login: 'ada-renamed', name: 'Ada' })
    expect(await router.withPlatform((tx) => identitiesOf(tx, before.id))).toMatchObject([{ provider: 'github', issuer: GITHUB_ISSUER, subject: '501' }])
  })

  it('makes one user per OIDC subject, refreshes their profile on each sign-in, and keeps their login', async () => {
    const first = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-1')))
    expect(first).toMatchObject({ kind: 'human', login: 'jo.okta', emails: ['jo@example.com'] })
    const again = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-1', { name: 'Jo B', login: 'jo-changed.okta', emails: ['jo@new.example.com'] })))
    expect(again).toMatchObject({ id: first.id, login: 'jo.okta', name: 'Jo B', emails: ['jo@new.example.com'] })
  })

  it('never links by email: another subject with the same email and login is another user, with a numbered login', async () => {
    const jo = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-1')))
    const twin = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-2')))
    expect(twin.id).not.toBe(jo.id)
    expect(twin.login).toBe('jo.okta-2')
    // The same subject at another issuer is someone else too.
    const elsewhere = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-1', { issuer: 'https://other-idp.example.com' })))
    expect(elsewhere.id).not.toBe(jo.id)
  })

  it('refuses a GitHub-shaped login for a provider other than GitHub', async () => {
    await expect(router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-9', { login: 'ada' })))).rejects.toThrow(/never a GitHub login/)
  })

  it('admits an OIDC identity by an allowlisted email or domain, or an invite to its email, and nothing else', async () => {
    const stranger = oidc('sub-stranger', { emails: ['stranger@elsewhere.example'], login: 'stranger.okta' })
    expect(await router.withPlatform((tx) => mayEnter(tx, stranger))).toBe(false)

    await router.withPlatform((tx) => replaceSigninAllowlist(tx, [{ kind: 'domain', value: 'elsewhere.example' }]))
    expect(await router.withPlatform((tx) => mayEnter(tx, stranger))).toBe(true)
    // An unverified email is never passed in, so a domain does not admit an identity without one.
    expect(await router.withPlatform((tx) => mayEnter(tx, { ...stranger, subject: 'sub-noemail', emails: [] }))).toBe(false)

    await router.withPlatform((tx) => replaceSigninAllowlist(tx, []))
    expect(await router.withPlatform((tx) => mayEnter(tx, stranger))).toBe(false)

    const owner = await router.withPlatform((tx) => upsertGitHubUser(tx, { id: 777, login: 'owner', name: null, avatarUrl: null, emails: [] }))
    const org = await router.withPlatform((tx) => insertOrg(tx, { id: newTenantId(), slug: 'acme', name: 'Acme', ownerId: owner.id }))
    await router.withPlatform((tx) => tx.query("UPDATE platform.orgs SET status = 'active' WHERE id = $1", [org.id]))
    const actor = await router.withPlatform((tx) => accessOf(tx, org.id, owner.id))
    await router.withPlatform((tx) => createInvite(tx, { orgId: org.id, who: 'stranger@elsewhere.example', roleId: 'reader', place: ACCOUNT, actorId: owner.id, actor: actor! }))
    expect(await router.withPlatform((tx) => mayEnter(tx, stranger))).toBe(true)
  })

  it('lets an allowlisted email or non-GitHub login create an account', async () => {
    const user = await router.withPlatform((tx) => resolveIdentity(tx, oidc('sub-maker', { login: 'maker.okta', emails: ['maker@corp.example'] })))
    expect(await router.withPlatform((tx) => isUserAllowlisted(tx, user.id))).toBe(false)
    await router.withPlatform((tx) => replaceSigninAllowlist(tx, [{ kind: 'email', value: 'maker@corp.example' }]))
    expect(await router.withPlatform((tx) => isUserAllowlisted(tx, user.id))).toBe(true)
    await router.withPlatform((tx) => replaceSigninAllowlist(tx, [{ kind: 'login', value: 'maker.okta' }]))
    expect(await router.withPlatform((tx) => isUserAllowlisted(tx, user.id))).toBe(true)
    await router.withPlatform((tx) => replaceSigninAllowlist(tx, []))
    expect(await router.withPlatform((tx) => isUserAllowlisted(tx, user.id))).toBe(false)
  })

  it('signs password users in as the config lists them, resets on a changed secret, and stops anyone taken off', async () => {
    const listed = [{ login: 'ops.admin', name: 'Ops', email: 'ops@example.com', password: 'correct horse battery' }]
    expect(await router.withPlatform((tx) => syncPasswordUsers(tx, listed))).toEqual({ created: ['ops.admin'], reset: [], removed: [] })
    // Idempotent on restart.
    expect(await router.withPlatform((tx) => syncPasswordUsers(tx, listed))).toEqual({ created: [], reset: [], removed: [] })

    const user = await router.withPlatform((tx) => passwordSignIn(tx, { login: 'ops.admin', password: 'correct horse battery' }))
    expect(user).toMatchObject({ login: 'ops.admin', emails: ['ops@example.com'] })
    expect(await router.withPlatform((tx) => passwordSignIn(tx, { login: 'ops.admin', password: 'wrong horse battery' }))).toBeNull()
    expect(await router.withPlatform((tx) => passwordSignIn(tx, { login: 'nobody.here', password: 'correct horse battery' }))).toBeNull()

    const { rows } = await db.superuser.query('SELECT hash FROM platform.password_credentials')
    expect(JSON.stringify(rows)).not.toContain('correct horse')

    const changed = [{ ...listed[0]!, password: 'a brand new passphrase' }]
    expect(await router.withPlatform((tx) => syncPasswordUsers(tx, changed))).toEqual({ created: [], reset: ['ops.admin'], removed: [] })
    expect(await router.withPlatform((tx) => passwordSignIn(tx, { login: 'ops.admin', password: 'correct horse battery' }))).toBeNull()
    expect(await router.withPlatform((tx) => passwordSignIn(tx, { login: 'ops.admin', password: 'a brand new passphrase' }))).toMatchObject({ id: user?.id })

    expect(await router.withPlatform((tx) => syncPasswordUsers(tx, []))).toEqual({ created: [], reset: [], removed: ['ops.admin'] })
    expect(await router.withPlatform((tx) => passwordSignIn(tx, { login: 'ops.admin', password: 'a brand new passphrase' }))).toBeNull()
  }, 30_000)

  it('refuses a GitHub-shaped or short-passworded password user', async () => {
    await expect(router.withPlatform((tx) => syncPasswordUsers(tx, [{ login: 'alice', name: null, email: null, password: 'long enough password' }]))).rejects.toThrow(/GitHub login/)
    await expect(router.withPlatform((tx) => syncPasswordUsers(tx, [{ login: 'al.ice', name: null, email: null, password: 'short' }]))).rejects.toThrow(/shorter/)
  })
})
