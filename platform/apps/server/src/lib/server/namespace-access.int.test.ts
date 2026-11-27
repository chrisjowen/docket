// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { CONTENT_CAPABILITIES, upsertGitHubUser, type Capability } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isHttpError, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const { load: orgLayout } = await import('../../routes/o/[org]/+layout.server')
const { load: casebook } = await import('../../routes/o/[org]/+page.server')
const { load: docketLayout } = await import('../../routes/o/[org]/w/[ws]/+layout.server')
const { GET: proposalsApi } = await import('../../routes/api/o/[org]/w/[ws]/proposals/+server')
const { inWorkspace } = await import('./workspace')
const { orgAccess } = await import('./request')
const { orgWorkspaces } = await import('./ask-runtime')

/** What each kind of member may do inside a docket they reach. */
const PROBED: readonly Capability[] = ['read', 'write', 'publish', 'delete', 'tokens', 'access']

// Real Postgres roles, migrations and grants; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)('namespace access in the web app', () => {
  let org: TestOrg
  let slug: string
  let alpha: string
  let beta: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member of the account, holding nothing until given a grant. */
  async function member(name: string, flags: { guest?: boolean } = {}) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [org.orgId, user.id, flags.guest ?? false])
    users[name] = { id: user.id, login: user.login }
  }
  /** A role on the account (`docket` null) or one docket, adjusted; `name` null gives it to everyone. */
  const grant = (name: string | null, docket: string | null, role: string, adjust: { add?: Capability[]; remove?: readonly Capability[] } = {}) =>
    org.db.app.query(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps, remove_caps) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [`g_${randomUUID()}`, org.orgId, name ? users[name]!.id : null, docket ? 'docket' : 'account', docket, role, adjust.add ?? [], adjust.remove ?? []],
    )

  function event(name: string, ws?: string): RequestEvent {
    const path = ws ? `/o/${slug}/w/${ws}` : `/o/${slug}`
    const url = new URL(`https://docket.example${path}`)
    return {
      params: { org: slug, ...(ws ? { ws } : {}) },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  /** The HTTP status a call answers with: 200 when it returns, the status of the error it throws otherwise. */
  async function status(call: () => unknown): Promise<number> {
    try {
      await call()
      return 200
    } catch (thrown) {
      if (isHttpError(thrown)) return thrown.status
      throw thrown
    }
  }

  const sidebar = async (name: string) =>
    ((await orgLayout(event(name) as never)) as { dockets: { slug: string; open: boolean }[] }).dockets.map(({ slug, open }) => `${slug}${open ? '' : ' (no access)'}`)
  const docket = (name: string, ws: string) => status(() => docketLayout(event(name, ws) as never))
  const api = (name: string, ws: string) => status(() => proposalsApi(event(name, ws) as never))
  const allowed = (name: string, ws: string) =>
    inWorkspace(event(name, ws), async ({ access }) => PROBED.filter((cap) => access.can(cap)))

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      caps: { status: async () => ({ spentUsd: 0, capUsd: 10, fraction: 0, warnedAt: null }) },
    } as unknown as Runtime
    ;[alpha, beta] = await org.withOrg(async ({ tx }) => [
      (await insertWorkspace(tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId })).id,
      (await insertWorkspace(tx, { name: 'Beta', slug: 'beta', createdBy: org.userId })).id,
    ])
    for (const name of ['admin', 'developer', 'reader', 'provisioner', 'promoted', 'publisher']) await member(name)
    await member('guest', { guest: true })
    // A role on the whole account covers both dockets; one on a docket, that docket alone.
    await grant('admin', null, 'admin')
    await grant('developer', null, 'writer')
    await grant('reader', alpha, 'reader')
    await grant('guest', alpha, 'reader')
    // Admin on the account without content: it manages, and reads nothing anywhere.
    await grant('provisioner', null, 'admin', { remove: CONTENT_CAPABILITIES })
    // Writer on the account, and Admin of alpha alone.
    await grant('promoted', null, 'writer')
    await grant('promoted', alpha, 'admin')
    // One person who may publish ontology changes, on alpha alone (the captain's "set at user level").
    await grant('publisher', null, 'reader')
    await grant('publisher', alpha, 'writer', { add: ['publish'] })
  })
  afterAll(() => org?.drop())

  it('lists in the sidebar only the dockets each member may see, and marks those they see but cannot open', async () => {
    expect(await sidebar('owner')).toEqual(['alpha', 'beta'])
    expect(await sidebar('admin')).toEqual(['alpha', 'beta'])
    expect(await sidebar('developer')).toEqual(['alpha', 'beta'])
    expect(await sidebar('reader')).toEqual(['alpha', 'beta (no access)'])
    expect(await sidebar('guest')).toEqual(['alpha'])
    expect(await sidebar('provisioner')).toEqual(['alpha (no access)', 'beta (no access)'])
  })

  it('opens a docket to those a grant lets read it: 404 for one they cannot see, 403 for one they see', async () => {
    const reach = async (name: string) => [await docket(name, 'alpha'), await docket(name, 'beta')]
    expect(await reach('owner')).toEqual([200, 200])
    expect(await reach('admin')).toEqual([200, 200])
    expect(await reach('developer')).toEqual([200, 200])
    expect(await reach('reader')).toEqual([200, 403])
    expect(await reach('guest')).toEqual([200, 404])
    expect(await reach('provisioner')).toEqual([403, 403])
    // The workspace APIs answer the same; a docket the org does not have is 404 to everyone.
    expect([await api('reader', 'beta'), await api('guest', 'beta'), await api('provisioner', 'alpha'), await api('guest', 'alpha')]).toEqual([403, 404, 403, 200])
    expect(await docket('owner', 'missing')).toBe(404)
  })

  it('decides what a member may do in a docket from every grant that covers it, and nothing more', async () => {
    expect(await allowed('owner', 'beta')).toEqual(PROBED)
    expect(await allowed('admin', 'beta')).toEqual(PROBED)
    expect(await allowed('developer', 'alpha')).toEqual(['read', 'write'])
    expect(await allowed('reader', 'alpha')).toEqual(['read'])
    expect(await allowed('guest', 'alpha')).toEqual(['read'])
    // Admin of one docket runs that docket, its access included, and nothing of any other docket.
    expect(await allowed('promoted', 'alpha')).toEqual(PROBED)
    expect(await allowed('promoted', 'beta')).toEqual(['read', 'write'])
    // One capability given to one person on one docket reaches only there.
    expect(await allowed('publisher', 'alpha')).toEqual(['read', 'write', 'publish'])
    expect(await allowed('publisher', 'beta')).toEqual(['read'])
  })

  it('gives what everyone is given to the people of the account, never to a guest', async () => {
    const before = await sidebar('reader')
    await grant(null, beta, 'reader')
    expect(await sidebar('reader')).toEqual(['alpha', 'beta'])
    expect(await docket('guest', 'beta')).toBe(404)
    expect(await sidebar('guest')).toEqual(['alpha'])
    await org.db.app.query("DELETE FROM platform.grants WHERE org_id = $1 AND principal_id IS NULL", [org.orgId])
    expect(await sidebar('reader')).toEqual(before)
  })

  it('keeps the casebook and Ask to the dockets each member reaches', async () => {
    const asked = async (name: string) => (await orgWorkspaces(await orgAccess(event(name)))).map((workspace) => workspace.slug)
    const filed = async (name: string) => ((await casebook(event(name) as never)) as { casebook: { slug: string }[] }).casebook.map((entry) => entry.slug)
    for (const name of ['owner', 'developer']) {
      expect(await asked(name)).toEqual(['alpha', 'beta'])
      expect(await filed(name)).toEqual(['alpha', 'beta'])
    }
    for (const name of ['reader', 'guest']) {
      expect(await asked(name)).toEqual(['alpha'])
      expect(await filed(name)).toEqual(['alpha'])
    }
    expect(await asked('provisioner')).toEqual([])
    expect(await filed('provisioner')).toEqual([])
  })
})
