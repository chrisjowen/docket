// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { aiCaps, recordUsage, setCap, spaceAiKeys } from '@docket/platform-ai'
import { issueApiToken, tokenHash, tokenResolver } from '@docket/platform-auth'
import { insertSpace, insertWorkspace } from '@docket/platform-canonical-store'
import { createTestOrg, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import type { SearchGraph } from '@docket/platform-mcp-tools'
import { CONTENT_CAPABILITIES, accessOf, createServiceAccount, upsertGitHubUser, type Access, type Tx } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryMailer } from './mail'
import { rateLimiter as addressLimiter } from './rate-limit'
import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('./runtime', () => ({ getRuntime: () => runtime }))
const { handleAccountMcp } = await import('./mcp-account')
const { handleMcp } = await import('./mcp')

const graph = (query: string): SearchGraph => ({
  schema: 'docket-search.v1',
  query,
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
})

type Rpc = { status: number; body: Record<string, any> | null }

// The account's MCP address (tenancy v2 §4): real Postgres, grants and token lookups; only the process runtime is injected.
describe.skipIf(!TEST_PG_URL)("an account's MCP address", () => {
  let org: TestOrg
  let other: { orgId: string; userId: string }
  const slug = () => `o-${org.orgId}`
  const ids: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  const dockets: Record<string, string> = {}
  let engineering = ''
  /** The docket each search was for, by the workspace the query service was asked about. */
  const searched: string[] = []

  const human = (login: string) =>
    org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))
  const grant = (userId: string, place: { kind: 'account' | 'space' | 'docket'; id: string | null }, role: string, adjust: { remove?: readonly string[] } = {}) =>
    org.db.admin.query(
      'INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, remove_caps) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [`g_${randomUUID()}`, org.orgId, userId, place.kind, place.id, role, adjust.remove ?? []],
    )
  async function member(name: string) {
    const user = await human(`${name}${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, user.id])
    return user.id
  }
  const token = (userId: string, input: { readOnly?: boolean; dockets?: string[] | null; orgId?: string } = {}) =>
    org.router.withPlatform(async (tx) =>
      (await issueApiToken(tx, { orgId: input.orgId ?? org.orgId, ownerId: userId, createdBy: userId, readOnly: input.readOnly ?? false, dockets: input.dockets ?? null })).token,
    )

  /** An OAuth access token as the authorization server stores one: for the account's address with a named connection, or a docket's without. */
  async function oauthToken(accountId: string, input: { resource: string; workspaceId?: string; connection?: { dockets: string[] | null; readOnly: boolean } }) {
    const raw = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const exp = Math.floor(Date.now() / 1000) + 900
    if (input.connection) {
      await org.db.admin.query(
        'INSERT INTO platform.oauth_connections (grant_id, org_id, user_id, client_id, name, read_only, dockets) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [grantId, org.orgId, accountId, 'client', 'Claude Code — Mac', input.connection.readOnly, input.connection.dockets],
      )
    }
    await org.db.admin.query(
      `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, account_id, client_id, resource, expires_at) VALUES
         ('Grant', $1, '{}', $2, $3, 'client', $4, now() + interval '1 day'),
         ('AccessToken', $5, $6, $2, $3, 'client', $4, now() + interval '15 minutes')`,
      [
        tokenHash(`grant:${grantId}`),
        grantId,
        accountId,
        input.resource,
        tokenHash(raw),
        {
          accountId,
          clientId: 'client',
          aud: input.resource,
          scope: 'docket:read docket:write',
          grantId,
          exp,
          extra: { org_id: org.orgId, ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}) },
        },
      ],
    )
    return raw
  }

  let calls = 0
  async function mcp(bearer: string, method: string, params: Record<string, unknown> = {}, query = ''): Promise<Rpc> {
    const url = new URL(`https://docket.example/mcp/${slug()}${query}`)
    const event = {
      url,
      params: { org: slug() },
      request: new Request(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: (calls += 1), method, params }),
      }),
      locals: { requestId: randomUUID(), startedAt: performance.now() },
      getClientAddress: () => '192.0.2.30',
    } as unknown as RequestEvent
    const response = await handleAccountMcp(event)
    const text = await response.text()
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null }
  }
  const tools = async (bearer: string, query = '') => {
    const { status, body } = await mcp(bearer, 'tools/list', {}, query)
    expect(status, JSON.stringify(body)).toBe(200)
    return (body?.result.tools as { name: string; inputSchema: { properties: Record<string, { enum?: string[] }>; required?: string[] } }[]) ?? []
  }
  const call = (bearer: string, name: string, args: Record<string, unknown>, query = '') => mcp(bearer, 'tools/call', { name, arguments: args }, query)

  beforeAll(async () => {
    org = await createTestOrg({ everyoneReadsGeneral: false })
    other = await org.addOrg()
    const eng = await org.withOrg(({ tx }) => insertSpace(tx, { name: 'Engineering', slug: 'eng', createdBy: org.userId }))
    engineering = eng.id
    dockets.payments = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Payments', slug: 'payments', createdBy: org.userId, spaceId: eng.id }))).id
    dockets.platform = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Platform', slug: 'platform', createdBy: org.userId, spaceId: eng.id }))).id
    dockets.legal = (await org.withOrg(({ tx }) => insertWorkspace(tx, { name: 'Legal', slug: 'legal', createdBy: org.userId }))).id
    ids.owner = org.userId
    ids.writer = await member('writer')
    await grant(ids.writer, { kind: 'space', id: eng.id }, 'writer')
    ids.reader = await member('reader')
    await grant(ids.reader, { kind: 'docket', id: dockets.legal }, 'reader')
    const owner = (await org.router.withPlatform((tx) => accessOf(tx, org.orgId, org.userId))) as Access
    ids.provisioner = (
      await org.router.withPlatform((tx) => createServiceAccount(tx, { orgId: org.orgId, name: `prov${org.orgId.slice(0, 6)}`, description: null, actorId: org.userId, actor: owner }))
    ).id
    // Admin on the account without content: it may set things up over MCP, and never reaches content.
    await grant(ids.provisioner, { kind: 'account', id: null }, 'admin', { remove: CONTENT_CAPABILITIES })
    tokens.owner = await token(ids.owner)
    tokens.writer = await token(ids.writer)
    tokens.reader = await token(ids.reader)
    tokens.provisioner = await token(ids.provisioner)
    tokens.writerPayments = await token(ids.writer, { dockets: [dockets.payments] })
    tokens.ownerReadOnly = await token(ids.owner, { readOnly: true })
    tokens.otherOwner = await token(other.userId, { orgId: other.orgId })

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      query: {
        search: async (input: { workspaceId: string; query: string }) => {
          searched.push(input.workspaceId)
          return graph(input.query)
        },
        ask: async () => Promise.reject(new Error('not used')),
      },
      caps: { assertWithinCap: async () => undefined },
      mailer: memoryMailer(),
    } as unknown as Runtime
  })
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 1000, windowMs: 60_000 })
    searched.length = 0
  })
  afterAll(() => org?.drop())

  it('lists the dockets a caller may use, and what it can do in each', async () => {
    const listed = await call(tokens.writer as string, 'docket_list', {})
    expect(listed.body?.result.structuredContent.dockets).toEqual([
      { docket: 'payments', name: 'Payments', space: 'Engineering', can: ['read', 'write', 'propose'] },
      { docket: 'platform', name: 'Platform', space: 'Engineering', can: ['read', 'write', 'propose'] },
    ])
    const initialized = await mcp(tokens.writer as string, 'initialize', { protocolVersion: '2025-06-18' })
    expect(initialized.body?.result.instructions).toContain('docket_list')
  })

  it('gives every docket tool a docket argument, naming only the dockets where that tool may run', async () => {
    const list = await tools(tokens.writer as string)
    const search = list.find((tool) => tool.name === 'docket_search')
    expect(search?.inputSchema.properties.docket?.enum).toEqual(['payments', 'platform'])
    expect(search?.inputSchema.properties.dockets).toBeDefined()
    const remember = list.find((tool) => tool.name === 'docket_remember')
    expect(remember?.inputSchema.required).toContain('docket')
    expect(remember?.inputSchema.properties.dockets).toBeUndefined()
    // A reader of one docket: its reads, no writes, nothing elsewhere.
    const reader = await tools(tokens.reader as string)
    expect(reader.map((tool) => tool.name)).toContain('docket_search')
    expect(reader.map((tool) => tool.name)).not.toContain('docket_remember')
    expect(reader.find((tool) => tool.name === 'docket_search')?.inputSchema.properties.docket?.enum).toEqual(['legal'])
  })

  it('routes each call to the docket it names, says which docket answered, and refuses one it may not use', async () => {
    const found = await call(tokens.writer as string, 'docket_search', { docket: 'platform', query: 'orders' })
    expect(found.status).toBe(200)
    expect(found.body?.result.content[0].text).toMatch(/^Docket: platform \(Platform\)/)
    expect(searched).toEqual([dockets.platform])
    const elsewhere = await call(tokens.writer as string, 'docket_search', { docket: 'legal', query: 'orders' })
    expect(elsewhere.body?.error).toMatchObject({ code: -32602 })
    expect(elsewhere.body?.error.message).toContain('payments, platform')
    // Two dockets, no docket named: the call fails and lists the choices.
    const ambiguous = await call(tokens.writer as string, 'docket_search', { query: 'orders' })
    expect(ambiguous.body?.error.message).toContain('one of payments, platform')
    // Reads may look in several at once; each result says which docket it came from.
    searched.length = 0
    const both = await call(tokens.writer as string, 'docket_search', { dockets: ['payments', 'platform'], query: 'orders' })
    expect(both.body?.result.structuredContent.results.map((result: { docket: string }) => result.docket)).toEqual(['payments', 'platform'])
    expect(searched).toEqual([dockets.payments, dockets.platform])
  })

  it('never writes to a default docket, unless the credential reaches that one docket alone', async () => {
    const unnamed = await call(tokens.writer as string, 'docket_remember', {})
    expect(unnamed.body?.error.message).toContain('Name the docket')
    // Named, the call reaches the tool, which refuses its empty arguments as a write on the pinned address does.
    const named = await call(tokens.writer as string, 'docket_remember', { docket: 'payments' })
    expect(named.body?.error).toMatchObject({ code: -32602 })
    expect(named.body?.error.message).not.toContain('Name the docket')
    expect((await call(tokens.writer as string, 'docket_remember', { dockets: ['payments'] })).body?.error.message).toContain('exactly one docket')
    // A token for Payments alone: Payments is implied.
    const pinned = await tools(tokens.writerPayments as string)
    expect(pinned.find((tool) => tool.name === 'docket_search')?.inputSchema.properties.docket?.enum).toEqual(['payments'])
    expect(pinned.find((tool) => tool.name === 'docket_remember')?.inputSchema.required ?? []).not.toContain('docket')
    expect((await call(tokens.writerPayments as string, 'docket_search', { query: 'orders' })).body?.result.content[0].text).toMatch(/^Docket: payments/)
  })

  it('drops the write tools with read_only=1, and refuses a write tool no docket allows', async () => {
    const reading = await tools(tokens.owner as string, '?read_only=1')
    expect(reading.map((tool) => tool.name)).toEqual(expect.arrayContaining(['docket_list', 'docket_search', 'docket_get']))
    expect(reading.map((tool) => tool.name)).not.toContain('docket_remember')
    const refused = await call(tokens.owner as string, 'docket_remember', { docket: 'legal' }, '?read_only=1')
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ error: 'insufficient_scope' })
    expect((await tools(tokens.ownerReadOnly as string)).map((tool) => tool.name)).not.toContain('docket_remember')
  })

  it('offers the admin tools only when asked for, and only to a caller who can manage, never one that mints tokens', async () => {
    expect((await tools(tokens.owner as string)).some((tool) => tool.name.startsWith('admin_'))).toBe(false)
    const admin = (await tools(tokens.owner as string, '?admin=1')).map((tool) => tool.name).filter((name) => name.startsWith('admin_'))
    expect(admin.sort()).toEqual(['admin_create_docket', 'admin_create_space', 'admin_create_system_account', 'admin_invite', 'admin_set_access', 'admin_update_docket', 'admin_usage'])
    expect(admin.some((name) => /token/.test(name))).toBe(false)
    expect((await tools(tokens.writer as string, '?admin=1')).some((tool) => tool.name.startsWith('admin_'))).toBe(false)
    expect((await tools(tokens.owner as string, '?admin=1&read_only=1')).some((tool) => tool.name.startsWith('admin_'))).toBe(false)
    // A token made before scopes went, still capped at reading and writing content, never manages.
    const legacy = await token(org.userId)
    await org.db.admin.query("UPDATE platform.api_tokens SET legacy_scopes = ARRAY['docket:read', 'docket:write'] WHERE token_hash = $1", [tokenHash(legacy)])
    const offered = (await tools(legacy, '?admin=1')).map((tool) => tool.name)
    expect(offered).toContain('docket_remember')
    expect(offered.some((name) => name.startsWith('admin_'))).toBe(false)
  })

  it('invites over MCP without ever handing the invite link to the model', async () => {
    const invited = await call(tokens.owner as string, 'admin_invite', { to: 'mcp-invitee@example.com', place: 'space:general', role: 'reader' }, '?admin=1')
    expect(invited.body?.result.isError, JSON.stringify(invited.body)).toBeUndefined()
    expect(invited.body?.result.structuredContent).toMatchObject({ to: 'mcp-invitee@example.com', link: null, emailed_to: 'mcp-invitee@example.com' })
    expect(JSON.stringify(invited.body)).not.toMatch(/dki_/)
  })

  it('lets a system account that manages without content set things up over MCP, as the API checks it, and read nothing', async () => {
    const list = await tools(tokens.provisioner as string, '?admin=1')
    expect(list.map((tool) => tool.name)).not.toContain('docket_search')
    // Making a space takes Admin on the whole account, content included.
    expect(list.map((tool) => tool.name)).not.toContain('admin_create_space')
    const docket = await call(tokens.provisioner as string, 'admin_create_docket', { space: 'general', name: 'Papers', template: 'blank' }, '?admin=1')
    expect(docket.body?.result.isError, JSON.stringify(docket.body)).toBeUndefined()
    expect(docket.body?.result.structuredContent).toMatchObject({ slug: 'papers', caps: expect.not.arrayContaining(['read']) })
    const writerLogin = `writer${org.orgId.slice(0, 6)}`
    // It gives only what it holds: content it cannot read, it cannot give.
    const tooMuch = await call(tokens.provisioner as string, 'admin_set_access', { who: writerLogin, place: 'docket:papers', role: 'reader' }, '?admin=1')
    expect(tooMuch.body?.result).toMatchObject({ isError: true })
    expect(tooMuch.body?.result.content[0].text).toContain('only give access you hold')
    // The owner gives it, and takes it away again.
    const given = await call(tokens.owner as string, 'admin_set_access', { who: writerLogin, place: 'docket:papers', role: 'reader' }, '?admin=1')
    expect(given.body?.result.structuredContent).toMatchObject({ role: { id: 'reader' }, place: { ref: 'docket:papers' } })
    const taken = await call(tokens.owner as string, 'admin_set_access', { who: writerLogin, place: 'docket:papers', role: null }, '?admin=1')
    expect(taken.body?.result.structuredContent).toMatchObject({ removed: expect.any(String) })
    expect((await call(tokens.provisioner as string, 'admin_usage', {}, '?admin=1')).body?.result.structuredContent).toMatchObject({ dockets: 4 })
    const { rows } = await org.withOrg(({ tx }) => tx.query<{ action: string; actor: string }>("SELECT action, actor FROM audit_event WHERE action LIKE 'mcp.tools/call admin_%' ORDER BY seq"))
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['mcp.tools/call admin_create_docket', 'mcp.tools/call admin_set_access']))
    expect(rows.find((row) => row.action === 'mcp.tools/call admin_create_docket')?.actor).toBe(`token:${(tokens.provisioner as string).slice(0, 16)}`)
  })

  it("asks a docket whose space pays with its own key once the account's cap is spent, and refuses the account's dockets", async () => {
    const platform = <T,>(fn: (tx: Tx) => Promise<T>) => org.router.withPlatform(fn)
    const stubbed = runtime.caps
    const query = runtime.query
    const asked: string[] = []
    runtime.caps = aiCaps({ platform, notifyOwners: async () => undefined })
    runtime.query = { ...query, ask: async (input: { workspaceId: string }) => (asked.push(input.workspaceId), { answer: { results: [], notice: { message: 'Nothing found.' } } }) } as unknown as Runtime['query']
    try {
      // Engineering pays OpenRouter with its own key; Docket's key has spent the account's whole $10 cap on Legal.
      await platform((tx) => spaceAiKeys({ platform, keysFor: (id) => org.keyring.forOrg(id) }).set(tx, { orgId: org.orgId, spaceId: engineering, provider: 'openrouter', key: 'sk-or-eng-4321', by: org.userId }))
      await platform((tx) => setCap(tx, org.orgId, 10, org.userId))
      await platform((tx) => recordUsage(tx, { orgId: org.orgId, workspaceId: dockets.legal as string, actor: 'x', purpose: 'synthesis', model: 'm', promptTokens: 0, completionTokens: 0, costUsd: 10 }))

      const own = await call(tokens.owner as string, 'docket_ask', { docket: 'payments', question: 'What changed?' })
      expect(own.body?.result.isError, JSON.stringify(own.body)).toBeUndefined()
      expect(asked).toEqual([dockets.payments])
      const account = await call(tokens.owner as string, 'docket_ask', { docket: 'legal', question: 'What changed?' })
      expect(account.body?.result).toMatchObject({ isError: true })
      expect(account.body?.result.content[0].text).toMatch(/budget/i)
      expect(asked).toEqual([dockets.payments])
    } finally {
      runtime.caps = stubbed
      runtime.query = query
    }
  })

  it('takes an OAuth connection made for the account, reaching only the dockets chosen at consent', async () => {
    const connected = await oauthToken(ids.owner as string, { resource: `https://docket.example/mcp/${slug()}`, connection: { dockets: [dockets.legal as string], readOnly: false } })
    expect((await call(connected, 'docket_list', {})).body?.result.structuredContent.dockets.map((docket: { docket: string }) => docket.docket)).toEqual(['legal'])
    // The same connection at a docket's own address reaches that docket only.
    const pinned = async (ws: string) => {
      const url = new URL(`https://docket.example/mcp/${slug()}/${ws}`)
      const event = {
        url,
        params: { org: slug(), ws },
        request: new Request(url, { method: 'POST', headers: { authorization: `Bearer ${connected}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
        locals: { requestId: randomUUID(), startedAt: performance.now() },
        getClientAddress: () => '192.0.2.30',
      } as unknown as RequestEvent
      return (await handleMcp(event)).status
    }
    expect(await pinned('legal')).toBe(200)
    expect(await pinned('payments')).toBe(401)
  })

  it("refuses another account's token, and a grant made before connections for one docket's address", async () => {
    const elsewhere = await mcp(tokens.otherOwner as string, 'tools/list')
    expect(elsewhere.status).toBe(401)
    expect(elsewhere.body).toMatchObject({ error: 'invalid_token' })
    const legacy = await oauthToken(ids.owner as string, { resource: `https://docket.example/mcp/${slug()}/legal`, workspaceId: dockets.legal })
    expect((await mcp(legacy, 'tools/list')).status).toBe(401)
  })
})
