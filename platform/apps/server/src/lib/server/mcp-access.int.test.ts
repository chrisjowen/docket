// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { newApiToken, tokenHash, tokenResolver, type Scope } from '@docket/platform-auth'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import type { SearchGraph } from '@docket/platform-mcp-tools'
import { CONTENT_CAPABILITIES, accessOf, createServiceAccount, upsertGitHubUser, type Access } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter as addressLimiter } from './rate-limit'
import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))
const { handleMcp } = await import('./mcp')

const graph: SearchGraph = {
  schema: 'docket-search.v1',
  query: 'orders',
  project: { name: 'Main', root: 'main' },
  matches: [],
  nodes: [],
  links: [],
  paths: [],
  omitted: 0,
  types: [],
  sources: [],
  index: { synced: true, behind: 0 },
  viewer: null,
  warnings: [],
}

const EVERY_SCOPE: Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write']

// Namespace access over MCP (tenancy design §5.1): real Postgres roles, migrations, grants and token lookups;
// only the process runtime is injected. Every credential below carries every scope, so what it can do is
// exactly what its owner may do on the docket now: every grant that covers it.
describe.skipIf(!TEST_PG_URL)('MCP access by grants on the account and the docket', () => {
  let org: TestOrg
  let main: string
  const orgSlug = () => `o-${org.orgId}`
  /** Each identity's API token for the workspace `main`, by name. */
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))

  /** A membership, holding a role on the whole account when `role` names one. */
  async function member(name: string, role: string | null, flags: { guest?: boolean } = {}): Promise<string> {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [org.orgId, user.id, flags.guest ?? false])
    if (role) await grant(user.id, null, role)
    return user.id
  }
  /** A role on the account (`docket` null) or on one docket, adjusted. */
  const grant = (userId: string, docket: string | null, role: string, adjust: { add?: string[]; remove?: readonly string[] } = {}) =>
    org.db.admin.query(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, add_caps, remove_caps) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [`g_${randomUUID()}`, org.orgId, userId, docket ? 'docket' : 'account', docket, role, adjust.add ?? [], adjust.remove ?? []],
    )
  const setDocketRole = (userId: string, role: string) =>
    org.db.admin.query("UPDATE platform.grants SET role_id = $3 WHERE principal_id = $1 AND place_kind = 'docket' AND place_id = $2", [userId, main, role])

  /** A token row as any issue path stores it, bound to `main`; issuing is not what is under test. */
  async function apiToken(ownerId: string): Promise<string> {
    const token = newApiToken()
    await org.db.admin.query(
      `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, dockets, owner_id, legacy_scopes, created_by, expires_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5], $6, $7, $6, now() + interval '1 day')`,
      [`tok_${randomBytes(6).toString('hex')}`, tokenHash(token), token.slice(0, 16), org.orgId, main, ownerId, EVERY_SCOPE],
    )
    return token
  }

  /** An OAuth access token for `main`'s MCP URL, as the authorization server's adapter stores one with its grant. */
  async function oauthToken(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const exp = Math.floor(Date.now() / 1000) + 900
    const resource = `https://docket.example/mcp/${orgSlug()}/main`
    await org.db.admin.query(
      `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, account_id, client_id, resource, expires_at) VALUES
         ('Grant', $1, '{}', $2, $3, 'client', $4, now() + interval '1 day'),
         ('AccessToken', $5, $6, $2, $3, 'client', $4, now() + interval '15 minutes')`,
      [
        tokenHash(`grant:${grantId}`),
        grantId,
        accountId,
        resource,
        tokenHash(raw),
        { accountId, clientId: 'client', aud: resource, scope: EVERY_SCOPE.join(' '), grantId, exp, extra: { org_id: org.orgId, workspace_id: main } },
      ],
    )
    return raw
  }

  let calls = 0
  async function mcp(bearer: string, method: string, params: Record<string, unknown> = {}) {
    const url = new URL(`https://docket.example/mcp/${orgSlug()}/main`)
    const event = {
      url,
      params: { org: orgSlug(), ws: 'main' },
      request: new Request(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: (calls += 1), method, params }),
      }),
      locals: { requestId: randomUUID(), startedAt: performance.now() },
      getClientAddress: () => '192.0.2.10',
    } as unknown as RequestEvent
    const response = await handleMcp(event)
    const text = await response.text()
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null }
  }

  const toolNames = async (bearer: string) => {
    const { status, body } = await mcp(bearer, 'tools/list')
    expect(status).toBe(200)
    return ((body?.result as { tools: { name: string }[] }).tools ?? []).map((tool) => tool.name)
  }
  const search = (bearer: string) => mcp(bearer, 'tools/call', { name: 'docket_search', arguments: { query: 'orders' } })
  // Arguments the tool refuses: a call that gets past the scope check is answered 200 with a JSON-RPC error.
  const write = (bearer: string) => mcp(bearer, 'tools/call', { name: 'docket_remember', arguments: {} })

  beforeAll(async () => {
    org = await createTestOrg()
    const other = await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Other', slug: 'other', createdBy: org.userId }))
    ids.owner = org.userId
    main = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Main', slug: 'main', createdBy: org.userId }))).id
    ids.admin = await member('admin', 'admin')
    ids.developer = await member('developer', 'writer')
    ids.readOnly = await member('readonly', 'reader')
    ids.guest = await member('guest', null, { guest: true })
    await grant(ids.guest, main, 'reader')
    ids.ungranted = await member('ungranted', null, { guest: true })
    const owner = (await org.router.withPlatform((tx) => accessOf(tx, org.orgId, org.userId))) as Access
    ids.provisioner = (
      await org.router.withPlatform((tx) =>
        createServiceAccount(tx, { orgId: org.orgId, name: `initech${org.orgId.slice(0, 6)}`, description: null, actorId: org.userId, actor: owner }),
      )
    ).id
    // Admin on the account without content: it may set things up, and must never reach content.
    await grant(ids.provisioner, null, 'admin', { remove: CONTENT_CAPABILITIES })
    // Writer on another docket only.
    ids.elsewhere = await member('elsewhere', null)
    await grant(ids.elsewhere, other.id, 'writer')
    // Writer + Publish ontology changes on `main`, given to this one person.
    ids.publisher = await member('publisher', 'reader')
    await grant(ids.publisher, main, 'writer', { add: ['publish'] })
    for (const [name, id] of Object.entries(ids)) tokens[name] = await apiToken(id)

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      query: { search: async () => graph, ask: async () => Promise.reject(new Error('not used')) },
      caps: { assertWithinCap: async () => undefined },
    } as unknown as Runtime
  })
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 1000, windowMs: 60_000 })
  })
  afterAll(() => org?.drop())

  it('lets owners, admins and writers on the account read and write', async () => {
    for (const name of ['owner', 'admin', 'developer']) {
      const token = tokens[name] as string
      expect(await toolNames(token)).toEqual(expect.arrayContaining(['docket_search', 'docket_remember', 'docket_propose_ontology_change']))
      expect((await search(token)).status).toBe(200)
      const written = await write(token)
      expect(written.status).toBe(200)
      expect(written.body).toMatchObject({ error: { code: -32602 } })
    }
  })

  it('lets readers on the account, and a guest given Reader on the docket, read but never write', async () => {
    for (const name of ['readOnly', 'guest']) {
      const token = tokens[name] as string
      const names = await toolNames(token)
      expect(names).toContain('docket_search')
      expect(names).not.toContain('docket_remember')
      expect((await search(token)).status).toBe(200)
      expect((await mcp(token, 'resources/list')).status).toBe(200)
      const refused = await write(token)
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ error: 'insufficient_scope' })
    }
  })

  it('refuses everything to a guest with no grant, a writer on another docket only, and a role without content', async () => {
    for (const name of ['ungranted', 'elsewhere', 'provisioner']) {
      const token = tokens[name] as string
      for (const answer of [await mcp(token, 'tools/list'), await search(token), await write(token), await mcp(token, 'resources/list')]) {
        expect(answer.status).toBe(401)
        expect(answer.body).toMatchObject({ error: 'invalid_token', error_description: 'This credential no longer grants anything in this workspace.' })
      }
    }
  })

  it('holds OAuth access tokens to the same grants', async () => {
    const owner = await oauthToken(ids.owner as string)
    expect(await toolNames(owner)).toContain('docket_remember')
    const reader = await oauthToken(ids.readOnly as string)
    expect((await search(reader)).status).toBe(200)
    expect((await write(reader)).status).toBe(403)
    for (const name of ['ungranted', 'elsewhere']) {
      expect((await search(await oauthToken(ids[name] as string))).status).toBe(401)
    }
  })

  it('narrows a live token from the next call when its grant is lowered or taken away', async () => {
    const token = await apiToken(ids.guest as string)
    await setDocketRole(ids.guest as string, 'writer')
    expect(await toolNames(token)).toContain('docket_remember')
    await setDocketRole(ids.guest as string, 'reader')
    expect((await write(token)).status).toBe(403)
    await org.db.admin.query("DELETE FROM platform.grants WHERE principal_id = $1 AND place_id = $2", [ids.guest, main])
    expect((await search(token)).status).toBe(401)
  })

  it('offers publishing the ontology over MCP only to whoever holds Publish ontology changes on the docket', async () => {
    expect(await toolNames(tokens.publisher as string)).toContain('docket_publish_ontology_change')
    expect(await toolNames(tokens.developer as string)).not.toContain('docket_publish_ontology_change')
    // An admin holds every capability, Publish included.
    expect(await toolNames(tokens.admin as string)).toContain('docket_publish_ontology_change')
    // Taken away, it is gone from the next call.
    await org.db.admin.query("UPDATE platform.grants SET add_caps = '{}' WHERE principal_id = $1 AND place_id = $2", [ids.publisher, main])
    expect(await toolNames(tokens.publisher as string)).not.toContain('docket_publish_ontology_change')
  })
})
