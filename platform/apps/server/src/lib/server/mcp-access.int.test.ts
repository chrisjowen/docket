// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { newApiToken, tokenHash, tokenResolver, type Scope } from '@docket/platform-auth'
import { insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import type { SearchGraph } from '@docket/platform-mcp-tools'
import { createServiceAccount, upsertGitHubUser } from '@docket/platform-tenancy'
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

const EVERY_SCOPE: Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']

// Namespace access over MCP (tenancy design §5.1): real Postgres roles, migrations, grants and token lookups;
// only the process runtime is injected. Every credential below carries every scope, so what it can do is
// exactly its owner's permission on the workspace now.
describe.skipIf(!TEST_PG_URL)('MCP access by account role and namespace grant', () => {
  let org: TestOrg
  let main: string
  const orgSlug = () => `o-${org.orgId}`
  /** Each identity's API token for the workspace `main`, by name. */
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))

  /** A membership as the app makes one (the account role follows `role`), or with an account role set outright. */
  async function member(name: string, role: string, accountRole?: string): Promise<string> {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id, role, account_role) VALUES ($1, $2, $3, $4)', [
      org.orgId,
      user.id,
      role,
      accountRole ?? null,
    ])
    return user.id
  }

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
    ids.admin = await member('admin', 'admin')
    ids.developer = await member('developer', 'editor')
    ids.readOnly = await member('readonly', 'viewer')
    ids.guest = await member('guest', 'viewer', 'guest')
    ids.ungranted = await member('ungranted', 'viewer', 'guest')
    ids.provisioner = (
      await org.router.withPlatform((tx) =>
        createServiceAccount(tx, { orgId: org.orgId, name: `initech${org.orgId.slice(0, 6)}`, description: null, role: 'editor', actorId: org.userId, actorRole: 'owner' }),
      )
    ).id
    await org.db.admin.query("UPDATE platform.memberships SET account_role = 'provisioner' WHERE user_id = $1", [ids.provisioner])
    // A developer who joined before `main` existed, then lost its grant there: theirs is on `other` only.
    ids.elsewhere = await member('elsewhere', 'editor')
    main = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Main', slug: 'main', createdBy: org.userId }))).id
    await org.db.admin.query('DELETE FROM platform.namespace_grants WHERE principal_id = $1 AND namespace_id = $2', [ids.elsewhere, main])
    // Grants by hand: read for one guest, and write for the provisioner, which must never reach content.
    await org.db.admin.query(
      `INSERT INTO platform.namespace_grants (org_id, namespace_id, principal_id, permission) VALUES ($1, $2, $3, 'read'), ($1, $2, $4, 'write')`,
      [org.orgId, main, ids.guest, ids.provisioner],
    )
    const { rows } = await org.db.admin.query<{ principal_id: string; namespace_id: string; permission: string }>(
      'SELECT principal_id, namespace_id, permission FROM platform.namespace_grants WHERE principal_id = $1',
      [ids.elsewhere],
    )
    expect(rows).toEqual([{ principal_id: ids.elsewhere, namespace_id: other.id, permission: 'write' }])
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

  it('lets owners, admins and developers read and write, as they do today', async () => {
    for (const name of ['owner', 'admin', 'developer']) {
      const token = tokens[name] as string
      expect(await toolNames(token)).toEqual(expect.arrayContaining(['docket_search', 'docket_remember', 'docket_propose_ontology_change']))
      expect((await search(token)).status).toBe(200)
      const written = await write(token)
      expect(written.status).toBe(200)
      expect(written.body).toMatchObject({ error: { code: -32602 } })
    }
  })

  it('lets read-only members, and a guest granted Read, read but never write', async () => {
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

  it('refuses everything to a guest with no grant, a developer granted another Docket only, and a provisioner', async () => {
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
    await org.db.admin.query("UPDATE platform.namespace_grants SET permission = 'write' WHERE principal_id = $1 AND namespace_id = $2", [ids.guest, main])
    expect(await toolNames(token)).toContain('docket_remember')
    await org.db.admin.query("UPDATE platform.namespace_grants SET permission = 'read' WHERE principal_id = $1 AND namespace_id = $2", [ids.guest, main])
    expect((await write(token)).status).toBe(403)
    await org.db.admin.query('DELETE FROM platform.namespace_grants WHERE principal_id = $1 AND namespace_id = $2', [ids.guest, main])
    expect((await search(token)).status).toBe(401)
  })
})
