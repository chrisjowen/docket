// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { upsertGitHubUser, type Action } from '@docket/platform-tenancy'
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

/** What each kind of member may do inside a docket they reach: the docket's own actions, and the org's. */
const PROBED: readonly Action[] = ['graph.read', 'knowledge.write', 'ontology.publish', 'workspaces.delete', 'tokens.manage', 'members.manage', 'org.administer']

// Real Postgres roles, migrations, account roles and namespace grants; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)('namespace access in the web app', () => {
  let org: TestOrg
  let slug: string
  let alpha: string
  let beta: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member as the app (and platform 0012's trigger) makes one; `accountRole` set outright for those `role` cannot express. */
  async function member(name: string, role: string, accountRole?: string) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, $3, $4)', [org.orgId, user.id, role, accountRole ?? null])
    users[name] = { id: user.id, login: user.login }
  }
  const grant = (name: string, workspaceId: string, permission: string) =>
    org.db.admin.query(
      `INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, namespace_id, principal_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [org.orgId, workspaceId, users[name]!.id, permission],
    )
  const ungrant = (name: string, workspaceId: string) =>
    org.db.admin.query('DELETE FROM platform.namespace_grants WHERE org_id = $1 AND namespace_id = $2 AND principal_id = $3', [org.orgId, workspaceId, users[name]!.id])

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
    inWorkspace(event(name, ws), async ({ access }) => PROBED.filter((action) => access.can(action)))

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
    await member('admin', 'admin')
    await member('developer', 'editor')
    await member('reader', 'viewer')
    await member('guest', 'viewer', 'guest')
    await member('provisioner', 'editor', 'provisioner')
    await member('promoted', 'editor')
    // Each new workspace grants developers write and read-only members read (platform 0013), as today's roles reach.
    ;[alpha, beta] = await org.withOrg(async ({ tx }) => [
      (await insertWorkspace(tx, { name: 'Alpha', slug: 'alpha', createdBy: org.userId })).id,
      (await insertWorkspace(tx, { name: 'Beta', slug: 'beta', createdBy: org.userId })).id,
    ])
    // Then grants the way they will differ: a reader kept out of beta, a guest let into alpha, a provisioner
    // granted (which reaches nothing), and a developer made admin of alpha.
    await ungrant('reader', beta)
    await grant('guest', alpha, 'read')
    await grant('provisioner', alpha, 'admin')
    await grant('promoted', alpha, 'admin')
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

  it('opens a docket to those its account role or a grant lets in: 404 for one they cannot see, 403 for one they see', async () => {
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

  it('decides what a member may do in a docket from their permission there, and the org-wide rest from their org role', async () => {
    const admins = ['graph.read', 'knowledge.write', 'ontology.publish', 'workspaces.delete', 'tokens.manage', 'members.manage']
    expect(await allowed('owner', 'beta')).toEqual([...admins, 'org.administer'])
    expect(await allowed('admin', 'beta')).toEqual(admins)
    expect(await allowed('developer', 'alpha')).toEqual(['graph.read', 'knowledge.write'])
    expect(await allowed('reader', 'alpha')).toEqual(['graph.read'])
    expect(await allowed('guest', 'alpha')).toEqual(['graph.read'])
    // Admin of one docket runs that docket, and nothing of the org's or of any other docket.
    expect(await allowed('promoted', 'alpha')).toEqual(['graph.read', 'knowledge.write', 'ontology.publish', 'workspaces.delete', 'tokens.manage'])
    expect(await allowed('promoted', 'beta')).toEqual(['graph.read', 'knowledge.write'])
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
