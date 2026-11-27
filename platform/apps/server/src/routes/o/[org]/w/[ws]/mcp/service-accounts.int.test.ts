// SPDX-License-Identifier: AGPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto'

import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { createServiceAccount, upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Runtime } from '$lib/server/runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
const { load, actions } = await import('./+page.server')

// Real Postgres roles, migrations and account roles; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)('service accounts on a docket\'s MCP page', () => {
  let org: TestOrg
  let slug: string
  const wsSlug = 'alpha'
  let wsId: string
  let serviceAccountId: string
  const users: Record<string, { id: string; login: string }> = {}

  /** A member as the app (and platform 0012's trigger) makes one; `role` decides their account role too. */
  async function member(name: string, role: string) {
    const user = await org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login: `${name}-${org.orgId.slice(0, 4)}`, name: null, avatarUrl: null, emails: [] }))
    await org.db.app.query('INSERT INTO platform.memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [org.orgId, user.id, role])
    users[name] = { id: user.id, login: user.login }
  }
  const grant = (name: string, workspaceId: string, permission: string) =>
    org.db.admin.query(
      `INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, namespace_id, principal_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [org.orgId, workspaceId, users[name]!.id, permission],
    )

  function event(name: string, form?: FormData): RequestEvent {
    const url = new URL(`https://docket.example/o/${slug}/w/${wsSlug}`)
    return {
      params: { org: slug, ws: wsSlug },
      locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
      url,
      request: form ? new Request(url, { method: 'POST', body: form }) : new Request(url),
      getClientAddress: () => '192.0.2.1',
    } as unknown as RequestEvent
  }

  function createTokenForm(owner: string) {
    const form = new FormData()
    form.set('owner', owner)
    form.set('scope', 'docket:read')
    form.set('days', '7')
    form.set('description', 'test')
    return form
  }

  beforeAll(async () => {
    org = await createTestOrg()
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      limiter: { check: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }) },
    } as unknown as Runtime
    // A developer promoted to admin of just this one docket, via creatorGrant.
    await member('developer', 'editor')
    await member('accountadmin', 'admin')
    wsId = (await org.withOrg((ctx) => insertWorkspace(ctx.tx, { name: 'Alpha', slug: wsSlug, createdBy: org.userId }))).id
    await grant('developer', wsId, 'admin')
    const service = await org.router.withPlatform((tx) =>
      createServiceAccount(tx, { orgId: org.orgId, name: 'ci-bot', description: null, role: 'viewer', actorId: org.userId, actorRole: 'owner' }),
    )
    serviceAccountId = service.id
  })
  afterAll(() => org?.drop())

  it('keeps the account-wide service-account roster and others\' tokens from a namespace-only admin', async () => {
    const data = (await load(event('developer') as never)) as { serviceAccounts: unknown[] }
    expect(data.serviceAccounts).toEqual([])

    const result = (await actions.createToken!(event('developer', createTokenForm(serviceAccountId)) as never)) as { status?: number }
    expect(result?.status).toBe(403)
  })

  it('shows the roster and lets an account owner or admin mint a token for a service account', async () => {
    const data = (await load(event('accountadmin') as never)) as { serviceAccounts: { id: string; name: string }[] }
    expect(data.serviceAccounts).toEqual([{ id: serviceAccountId, name: 'ci-bot', role: 'viewer' }])

    const result = (await actions.createToken!(event('accountadmin', createTokenForm(serviceAccountId)) as never)) as { created?: { token: string } }
    expect(result?.created?.token).toBeTruthy()
  })
})
