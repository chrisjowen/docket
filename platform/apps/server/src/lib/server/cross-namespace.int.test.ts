// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { newApiToken, tokenHash, tokenResolver, type ConsentRequest, type Scope } from '@docket/platform-auth'
import { hashContent, insertWorkspace, listDocuments, liveSupersessions, putDocument, supersedeResource, writeResource, type Writer } from '@docket/platform-canonical-store'
import { createTestOrg, readFixture, type TestOrg } from '@docket/platform-canonical-store/testing'
import { memoryBucketStore, rateLimiter } from '@docket/platform-limits'
import type { SearchGraph } from '@docket/platform-mcp-tools'
import { CONTENT_CAPABILITIES, upsertGitHubUser } from '@docket/platform-tenancy'
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimiter as addressLimiter } from './rate-limit'
import type { Runtime } from './runtime'

let runtime: Runtime
vi.mock('$lib/server/runtime', () => ({ getRuntime: () => runtime }))
// The consent screen's OAuth plumbing, so the test decides which resource a sign-in asks for; the access check is real.
const consents = vi.hoisted(() => ({ request: null as unknown, approved: [] as unknown[] }))
vi.mock('@docket/platform-auth', async (actual) => ({
  ...(await actual<typeof import('@docket/platform-auth')>()),
  interactionCookieValid: () => true,
  describeConsent: async () => consents.request,
  approveConsent: async (_provider: unknown, _uid: string, approved: unknown) => {
    consents.approved.push(approved)
    return { continueTo: 'https://docket.example/oauth/resume', grantId: `grant-${consents.approved.length}-${Math.random().toString(36).slice(2)}` }
  },
}))
const { handleMcp } = await import('./mcp')
const { load: orgLayout } = await import('../../routes/o/[org]/+layout.server')
const { load: docketLayout } = await import('../../routes/o/[org]/w/[ws]/+layout.server')
const { GET: commandSearch } = await import('../../routes/o/[org]/search/+server')
const consentPage = await import('../../routes/oauth/consent/[uid]/+page.server')

const ROUTES = join(import.meta.dirname, '..', '..', 'routes')
/** Every route that works on one docket, for a signed-in member or a bearer token: the docket is the `[ws]` in its path. */
const DOCKET_TREES = [join(ROUTES, 'o', '[org]', 'w', '[ws]'), join(ROUTES, 'api', 'o', '[org]', 'w', '[ws]')]
const HANDLERS = ['load', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const MARK = { alpha: 'ALPHA-MARK', beta: 'BETA-MARK', elsewhere: 'OTHER-ACCOUNT-MARK' } as const
const EVERY_SCOPE: Scope[] = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']
/**
 * A well-formed request to any docket route, so a handler that checks its input before its access still reaches
 * the access check: what a refusal must then stop is a write that would otherwise land.
 */
const WELL_FORMED = { yaml: 'kind: leak', source: 'human', decision: 'confirm', note: 'leak', reason: 'leak', migration: [], schedule: 'nightly', confirm: 'beta' }
const wellFormedForm = () => {
  const form = new FormData()
  for (const [name, value] of Object.entries(WELL_FORMED)) if (typeof value === 'string') form.append(name, value)
  form.append('files', new File(['---\nid: service.leak\ntype: service\ntitle: leak\n---\n'], 'leak.md'))
  return form
}

const emptyGraph = (query: string): SearchGraph => ({
  schema: 'docket-search.v1',
  query,
  project: { name: 'Docket', root: 'docket' },
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

interface Member {
  name: string
  /** A guest sees only what they are given; a provisioner holds a role on alpha without any content capability. */
  accountRole?: 'guest' | 'provisioner'
  /** Their role on alpha, by how far it reaches. They hold nothing on beta. */
  permission: 'read' | 'write' | 'admin'
}

const ROLE_OF = { read: 'reader', write: 'writer', admin: 'admin' } as const

/** Members and guests holding each built-in role on alpha alone, and one that manages alpha without reading it. */
const GRANTED_ALPHA_ONLY: Member[] = [
  ...(['read', 'write', 'admin'] as const).flatMap((permission): Member[] => [
    { name: `member-${permission}`, permission },
    { name: `guest-${permission}`, accountRole: 'guest', permission },
  ]),
  // Admin on alpha without content: it manages, and reaches no content anywhere.
  { name: 'provisioner', accountRole: 'provisioner', permission: 'admin' },
]
/** What beta answers a member of the account with no grant there: 404 to a guest, who may not see it exists; 403 to the rest. */
const refusalOnBeta = (member: Member) => (member.accountRole === 'guest' ? 404 : 403)

/** The HTTP status a handler answers with: a Response's or an action failure's, an HTTP error's or redirect's it throws, 200 otherwise. */
async function statusOf(call: () => unknown): Promise<number> {
  try {
    const value = await call()
    if (value instanceof Response) return value.status
    if (isActionFailure(value)) return value.status
    return 200
  } catch (thrown) {
    if (isHttpError(thrown) || isRedirect(thrown)) return thrown.status
    throw thrown
  }
}

async function routeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^\+(page|layout)?\.?server\.ts$|^\+server\.ts$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

// Cross-namespace isolation (tenancy design §5, phase 2c): one account with two Dockets, alpha and beta, holding
// different knowledge under the same ids, and a second account with a Docket also called alpha. Every member
// below is granted alpha only, and nothing they hold - a session, an API token or an OAuth token - reads,
// searches, writes, lists or sees beta, or anything of the other account, through any route, API, MCP tool or
// resource, or OAuth consent. Real Postgres roles, migrations, grants and token lookups; only the runtime is injected.
describe.skipIf(!TEST_PG_URL)('cross-namespace isolation', () => {
  let org: TestOrg
  let slug: string
  let other: { orgId: string; userId: string; login: string; slug: string }
  const docket = { alpha: '', beta: '' }
  const users: Record<string, { id: string; login: string }> = {}
  /** API tokens and OAuth access tokens, by member, bound to alpha; and one of the owner's bound to beta. */
  const apiTokens: Record<string, string> = {}
  const oauthTokens: Record<string, string> = {}
  let betaTokenId = ''
  let betaToken = ''
  let betaProposal = ''
  let betaSecretPath = ''
  /** The workspaces the query service was asked to search, by id. */
  const searched: string[] = []

  async function human(login: string) {
    return org.router.withPlatform((tx) => upsertGitHubUser(tx, { id: randomInt(1, 2 ** 31), login, name: null, avatarUrl: null, emails: [] }))
  }

  async function seed(orgId: string, workspaceSlug: string, mark: string, createdBy: string): Promise<string> {
    const fixture = await readFixture()
    const keys = await org.keyring.forOrg(orgId)
    return org.router.withTenant(orgId, async (tx) => {
      const ctx = { tx, keys }
      const workspace = await insertWorkspace(tx, { name: workspaceSlug, slug: workspaceSlug, createdBy })
      await tx.query(
        `INSERT INTO ontology_versions (workspace_id, number, status, yaml, yaml_hash, source, author, published_at, published_by)
         VALUES ($1, 1, 'published', $2, $3, 'import', $4, now(), $4)`,
        [workspace.id, fixture.ontology, hashContent(fixture.ontology), createdBy],
      )
      for (const document of fixture.documents) {
        await putDocument(ctx, { workspaceId: workspace.id, ...document, origin: 'repo', originRef: 'conn1:.docket', actor: 'system:repo-sync' })
      }
      const writer: Writer = { workspaceId: workspace.id, actor: `user:${createdBy}`, label: 'seed', channel: 'mcp', requestId: randomUUID() }
      // The same id in every Docket, each holding its own knowledge, and one only this Docket has.
      for (const [id, title] of [
        ['service.shared', `Shared ${mark}`],
        [`service.secret-${workspaceSlug === 'beta' ? 'beta' : 'alpha'}`, `Secret ${mark}`],
      ] as const) {
        await writeResource(ctx, writer, { id, type: 'service', title, evidence: [{ source: 'human', note: mark }] })
      }
      return workspace.id
    })
  }

  /** What beta holds, to tell that nothing reached it: its documents' revisions and its proposals. */
  const betaState = () =>
    org.withOrg(async (ctx) => ({
      documents: (await listDocuments(ctx.tx, docket.beta)).map((document) => [document.path, document.revision]),
      proposals: (await liveSupersessions(ctx, docket.beta)).map((proposal) => [proposal.id, proposal.status, proposal.evidence.length]),
    }))

  async function apiToken(ownerId: string, workspaceId: string, orgId = org.orgId): Promise<{ id: string; token: string }> {
    const token = newApiToken()
    const id = `tok_${randomBytes(6).toString('hex')}`
    await org.db.admin.query(
      `INSERT INTO platform.api_tokens (id, token_hash, prefix, org_id, dockets, owner_id, legacy_scopes, created_by, expires_at)
       VALUES ($1, $2, $3, $4, ARRAY[$5], $6, $7, $6, now() + interval '1 day')`,
      [id, tokenHash(token), token.slice(0, 16), orgId, workspaceId, ownerId, EVERY_SCOPE],
    )
    return { id, token }
  }

  /** An OAuth access token for alpha's MCP URL, as the authorization server's adapter stores one with its grant. */
  async function oauthToken(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const resource = `https://docket.example/mcp/${slug}/alpha`
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
        {
          accountId,
          clientId: 'client',
          aud: resource,
          scope: EVERY_SCOPE.join(' '),
          grantId,
          exp: Math.floor(Date.now() / 1000) + 900,
          extra: { org_id: org.orgId, workspace_id: docket.alpha },
        },
      ],
    )
    return raw
  }

  /** A signed-in member's request to a docket's route, shaped as SvelteKit hands one to a handler. */
  function sessionEvent(
    name: string,
    orgSlug: string,
    ws: string | null,
    options: { method?: string; path?: string; params?: Record<string, string>; body?: 'form' | 'json' } = {},
  ) {
    const method = options.method ?? 'GET'
    const body =
      options.body === 'json'
        ? { body: JSON.stringify(WELL_FORMED), headers: { 'content-type': 'application/json' } }
        : { body: options.body === 'form' ? wellFormedForm() : new FormData() }
    const url = new URL(`https://docket.example/o/${orgSlug}${ws ? `/w/${ws}` : ''}${options.path ?? ''}`)
    const event: Record<string, unknown> = {
      params: { org: orgSlug, ...(ws ? { ws } : {}), ...options.params },
      locals: {
        user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false },
        startedAt: performance.now(),
        requestId: randomUUID(),
        csrf: 'csrf',
      },
      url,
      route: { id: null },
      request: new Request(url, method === 'GET' ? {} : { method, ...body }),
      cookies: { get: () => undefined, getAll: () => [], set() {}, delete() {}, serialize: () => '' },
      setHeaders() {},
      depends() {},
      untrack: <T>(fn: () => T) => fn(),
      fetch: () => Promise.reject(new Error('a handler fetched')),
      getClientAddress: () => '192.0.2.1',
      isDataRequest: false,
      isSubRequest: false,
      platform: undefined,
    }
    // Layouts run before a page's load, as SvelteKit runs them.
    event.parent = async () => ({ ...(await orgLayout(event as never)), ...(ws ? await docketLayout(event as never) : {}) })
    return event as unknown as RequestEvent
  }

  /** A bearer request to the CLI API or the MCP endpoint, for `ws` in `orgSlug`. */
  function bearerEvent(bearer: string, orgSlug: string, ws: string, path: string, options: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
    const url = new URL(`https://docket.example${path}`)
    const method = options.method ?? 'GET'
    return {
      url,
      params: { org: orgSlug, ws, ...options.params },
      request: new Request(url, {
        method,
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(options.body ?? {}) }),
      }),
      locals: { requestId: randomUUID(), startedAt: performance.now() },
      getClientAddress: () => '192.0.2.10',
    } as unknown as RequestEvent
  }

  let calls = 0
  async function mcp(bearer: string, ws: string, method: string, params: Record<string, unknown> = {}, orgSlug = slug) {
    const event = bearerEvent(bearer, orgSlug, ws, `/mcp/${orgSlug}/${ws}`, { method: 'POST', body: { jsonrpc: '2.0', id: (calls += 1), method, params } })
    const response = await handleMcp(event)
    const text = await response.text()
    return { status: response.status, text }
  }
  const tool = (bearer: string, ws: string, name: string, args: Record<string, unknown>) => mcp(bearer, ws, 'tools/call', { name, arguments: args })

  beforeAll(async () => {
    // Who reaches what from grants alone: without General's default Reader for everyone.
    org = await createTestOrg({ everyoneReadsGeneral: false })
    slug = `o-${org.orgId}`
    users.owner = { id: org.userId, login: org.login }
    docket.alpha = await seed(org.orgId, 'alpha', MARK.alpha, org.userId)
    docket.beta = await seed(org.orgId, 'beta', MARK.beta, org.userId)
    const added = await org.addOrg()
    other = { ...added, slug: `o-${added.orgId}` }
    await seed(other.orgId, 'alpha', MARK.elsewhere, other.userId)

    const admin = await human(`admin-${org.orgId.slice(0, 6)}`)
    await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id) VALUES ($1, $2)', [org.orgId, admin.id])
    await org.db.admin.query("INSERT INTO platform.grants (id, org_id, principal_id, place_kind, role_id) VALUES ($1, $2, $3, 'account', 'admin')", [
      `g_${randomUUID()}`,
      org.orgId,
      admin.id,
    ])
    users.admin = { id: admin.id, login: admin.login }
    for (const member of GRANTED_ALPHA_ONLY) {
      const user = await human(`${member.name}-${org.orgId.slice(0, 6)}`)
      await org.db.admin.query('INSERT INTO platform.memberships (org_id, user_id, guest) VALUES ($1, $2, $3)', [org.orgId, user.id, member.accountRole === 'guest'])
      await org.db.admin.query(
        "INSERT INTO platform.grants (id, org_id, principal_id, place_kind, place_id, role_id, remove_caps) VALUES ($1, $2, $3, 'docket', $4, $5, $6)",
        [`g_${randomUUID()}`, org.orgId, user.id, docket.alpha, ROLE_OF[member.permission], member.accountRole === 'provisioner' ? CONTENT_CAPABILITIES : []],
      )
      users[member.name] = { id: user.id, login: user.login }
    }
    for (const [name, user] of Object.entries(users)) {
      apiTokens[name] = (await apiToken(user.id, docket.alpha)).token
      oauthTokens[name] = await oauthToken(user.id)
    }
    ;({ id: betaTokenId, token: betaToken } = await apiToken(org.userId, docket.beta))

    // A proposal in beta, and the path of the document only beta has.
    betaProposal = await org.withOrg(async (ctx) => {
      const writer: Writer = { workspaceId: docket.beta, actor: `user:${org.userId}`, label: 'seed', channel: 'mcp', requestId: randomUUID() }
      const proposed = await supersedeResource(ctx, writer, { id: 'service.shared', by: 'service.secret-beta', reason: MARK.beta, evidence: [{ source: 'human', note: MARK.beta }] })
      betaSecretPath = (await listDocuments(ctx.tx, docket.beta)).find((document) => document.resourceId === 'service.secret-beta')!.path
      return proposed.supersession!.id
    })

    runtime = {
      router: org.router,
      keyring: org.keyring,
      origin: 'https://docket.example',
      platformAdmins: new Set(),
      tokens: tokenResolver({ platform: (fn) => org.router.withPlatform(fn), ttlMs: 0 }),
      query: {
        search: async (input: { workspaceId: string; query: string }) => {
          searched.push(input.workspaceId)
          return emptyGraph(input.query)
        },
        ask: async () => Promise.reject(new Error('not used')),
      },
      caps: { assertWithinCap: async () => undefined, status: async () => ({ spentUsd: 0, capUsd: 10, fraction: 0, warnedAt: null }) },
      oauth: { provider: {} },
      oauthCookieKeys: [],
    } as unknown as Runtime
  }, 120_000)
  beforeEach(() => {
    const at = Date.now()
    runtime.limiter = rateLimiter({ store: memoryBucketStore({ now: () => at }), now: () => at })
    runtime.refusedAuth = addressLimiter({ limit: 100_000, windowMs: 60_000 })
    searched.length = 0
  })
  afterAll(() => org?.drop())

  describe('the web app, signed in', () => {
    // Some 900 calls: 20 s on its own, longer beside the other suites sharing the stores.
    it('refuses beta, and the other account, on every docket route: each page, action and API', async () => {
      const handlers: { route: string; name: string; call: (event: RequestEvent) => unknown; method: string; body?: 'form' | 'json' }[] = []
      for (const file of (await Promise.all(DOCKET_TREES.map(routeFiles))).flat()) {
        const route = relative(ROUTES, file).split(sep).join('/')
        // The CLI's bearer-only API is held to the same docket below, by token.
        if ((await readFile(file, 'utf8')).includes('handleCli(')) continue
        const module = (await import(/* @vite-ignore */ file)) as Record<string, unknown>
        for (const name of HANDLERS) {
          const handler = module[name]
          if (typeof handler === 'function') handlers.push({ route, name, call: handler as never, method: name === 'load' ? 'GET' : name, body: 'json' })
        }
        for (const [name, action] of Object.entries((module.actions as Record<string, unknown> | undefined) ?? {})) {
          handlers.push({ route, name: `actions.${name}`, call: action as never, method: 'POST', body: 'form' })
        }
      }
      // Every docket route is in the sweep: pages, actions and the workspace APIs.
      expect(handlers.length).toBeGreaterThan(40)
      expect(handlers.map((handler) => `${handler.route} ${handler.name}`)).toEqual(
        expect.arrayContaining([
          'o/[org]/w/[ws]/+layout.server.ts load',
          'o/[org]/w/[ws]/documents/[...path]/+page.server.ts load',
          'o/[org]/w/[ws]/proposals/[id]/+page.server.ts actions.accept',
          'o/[org]/w/[ws]/settings/+page.server.ts load',
          'o/[org]/w/[ws]/mcp/+page.server.ts load',
          'api/o/[org]/w/[ws]/proposals/[id]/+server.ts POST',
        ]),
      )

      const params = { id: betaProposal, path: betaSecretPath, login: users.owner!.login }
      const request = (handler: (typeof handlers)[number]) => ({ method: handler.method, params, body: handler.body, path: '?id=service.shared&q=Secret' })
      const before = await betaState()
      const answers: string[] = []
      const expected: string[] = []
      for (const member of GRANTED_ALPHA_ONLY) {
        // The control: alpha opens, so a refusal on beta is the grant deciding, not a broken request.
        expect(await statusOf(() => docketLayout(sessionEvent(member.name, slug, 'alpha') as never))).toBe(member.accountRole === 'provisioner' ? 403 : 200)
        for (const handler of handlers) {
          const event = sessionEvent(member.name, slug, 'beta', request(handler))
          answers.push(`${member.name} ${handler.route} ${handler.name} ${await statusOf(() => handler.call(event))}`)
          expected.push(`${member.name} ${handler.route} ${handler.name} ${refusalOnBeta(member)}`)
        }
      }
      // Nobody in this account reaches the other account's Docket of the same name, nor its owner.
      for (const name of ['owner', 'admin', 'member-admin', 'guest-admin']) {
        for (const handler of handlers) {
          const event = sessionEvent(name, other.slug, 'alpha', request(handler))
          answers.push(`${name} elsewhere ${handler.route} ${handler.name} ${await statusOf(() => handler.call(event))}`)
          expected.push(`${name} elsewhere ${handler.route} ${handler.name} 404`)
        }
      }
      expect(answers).toEqual(expected)
      expect(await betaState()).toEqual(before)
    }, 90_000)

    it('never names beta to a guest, nor the other account to anyone, in the sidebar', async () => {
      const sidebar = async (name: string, orgSlug = slug) =>
        statusOf(async () => ((await orgLayout(sessionEvent(name, orgSlug, null) as never)) as { dockets: { slug: string }[] }).dockets.map((d) => d.slug))
      for (const member of GRANTED_ALPHA_ONLY.filter((m) => m.accountRole === 'guest')) {
        const { dockets } = (await orgLayout(sessionEvent(member.name, slug, null) as never)) as { dockets: { slug: string }[] }
        expect(dockets.map((d) => d.slug)).toEqual(['alpha'])
      }
      for (const name of ['owner', 'admin', 'member-admin', 'guest-read']) expect(await sidebar(name, other.slug)).toBe(404)
    })

    it('searches only the dockets a member reaches from the command menu, even when beta is named', async () => {
      const search = async (name: string, query: string) => {
        const response = await commandSearch(sessionEvent(name, slug, null, { path: `/search?${query}` }) as never)
        expect(response.status).toBe(200)
        return response.text()
      }
      for (const member of GRANTED_ALPHA_ONLY.filter((m) => m.accountRole !== 'provisioner')) {
        for (const query of ['q=Secret', 'q=Secret&ws=beta', 'q=Secret&ws=alpha&ws=beta']) {
          searched.length = 0
          const body = await search(member.name, query)
          expect(body, `${member.name} ${query}`).not.toContain(MARK.beta)
          expect(searched).not.toContain(docket.beta)
        }
      }
      // The control: the owner, who reaches beta, is searched there and finds it.
      searched.length = 0
      expect(await search('owner', 'q=Secret&ws=beta')).toContain(MARK.beta)
      expect(searched).toEqual([docket.beta])
    })

    it('lets no member approve an MCP client for a docket they were not granted, nor one in another account', async () => {
      const consent = (resource: string): ConsentRequest => ({
        uid: 'uid',
        clientId: 'client',
        clientName: 'A client',
        device: false,
        preRegistered: false,
        metadataDocument: false,
        clientIdHost: null,
        redirectUri: 'http://127.0.0.1:9/callback',
        redirectHost: '127.0.0.1:9',
        localApp: true,
        resource,
        requested: ['docket:read', 'docket:write'],
      })
      const approve = async (name: string, resource: string) => {
        consents.request = consent(resource)
        consents.approved.length = 0
        const url = new URL('https://docket.example/oauth/consent/uid')
        const body = new FormData()
        body.append('name', 'Sweep client')
        // A connection may name more of the account's dockets, never one the member was not granted.
        body.append('docket', docket.beta)
        const event = {
          params: { uid: 'uid' },
          url,
          request: new Request(url, { method: 'POST', body }),
          cookies: { get: () => undefined },
          locals: { user: { ...users[name]!, name: null, avatarUrl: null, emails: [], allowlisted: false }, startedAt: performance.now(), requestId: randomUUID() },
          getClientAddress: () => '192.0.2.1',
        } as unknown as RequestEvent
        const status = await statusOf(() => consentPage.actions.approve!(event as never))
        return { status, approved: [...consents.approved] }
      }
      const beta = `https://docket.example/mcp/${slug}/beta`
      const elsewhere = `https://docket.example/mcp/${other.slug}/alpha`
      for (const member of GRANTED_ALPHA_ONLY) {
        expect(await approve(member.name, beta), member.name).toEqual({ status: 403, approved: [] })
        expect(await approve(member.name, elsewhere), member.name).toEqual({ status: 403, approved: [] })
      }
      for (const name of ['owner', 'admin']) expect(await approve(name, elsewhere), name).toEqual({ status: 403, approved: [] })
      // The control: alpha is approved, as a connection that reaches alpha alone, beta though it was asked for.
      expect(await approve('member-read', `https://docket.example/mcp/${slug}/alpha`)).toMatchObject({ status: 200, approved: [{ resource: `https://docket.example/mcp/${slug}/alpha` }] })
      const { rows } = await org.db.admin.query<{ dockets: string[] }>("SELECT dockets FROM platform.oauth_connections WHERE name = 'Sweep client'")
      expect(rows).toEqual([{ dockets: [docket.alpha] }])
    })
  })

  describe('MCP', () => {
    const everyone = () => ['owner', 'admin', ...GRANTED_ALPHA_ONLY.map((member) => member.name)]

    it('refuses an alpha token, API or OAuth, on beta and on the other account, for every call', async () => {
      for (const name of everyone()) {
        for (const token of [apiTokens[name]!, oauthTokens[name]!]) {
          for (const [ws, orgSlug] of [['beta', slug], ['alpha', other.slug]] as const) {
            for (const [method, params] of [
              ['tools/list', {}],
              ['resources/list', {}],
              ['tools/call', { name: 'docket_search', arguments: { query: 'Secret' } }],
              ['tools/call', { name: 'docket_get', arguments: { id: 'service.shared' } }],
              ['tools/call', { name: 'docket_retire', arguments: { id: 'service.shared', reason: 'gone' } }],
            ] as const) {
              const answer = await mcp(token, ws, method, params, orgSlug)
              expect(answer.status, `${name} ${orgSlug === slug ? ws : 'elsewhere'} ${method}`).toBe(401)
              expect(answer.text).not.toMatch(/MARK/)
            }
          }
        }
      }
      expect(searched).toEqual([])
    })

    it('reads alpha only through an alpha token: never beta knowledge under the same id, nor a resource only beta has', async () => {
      for (const name of ['owner', ...GRANTED_ALPHA_ONLY.filter((m) => m.accountRole !== 'provisioner').map((m) => m.name)]) {
        const token = apiTokens[name]!
        const shared = await tool(token, 'alpha', 'docket_get', { id: 'service.shared' })
        expect(shared.status).toBe(200)
        expect(shared.text).toContain(MARK.alpha)
        expect(shared.text).not.toContain(MARK.beta)
        const secret = await tool(token, 'alpha', 'docket_get', { id: 'service.secret-beta' })
        expect(secret.text).not.toContain(MARK.beta)
        const listed = await mcp(token, 'alpha', 'resources/list')
        expect(listed.status).toBe(200)
        expect(listed.text).not.toContain('secret-beta')
        expect(listed.text).not.toContain(MARK.beta)
        await tool(token, 'alpha', 'docket_search', { query: 'Secret' })
      }
      expect(new Set(searched)).toEqual(new Set([docket.alpha]))
    })

    it('writes to alpha only through an alpha token, whatever beta ids it names', async () => {
      const before = await betaState()
      for (const name of ['owner', 'admin', ...GRANTED_ALPHA_ONLY.filter((m) => m.permission !== 'read').map((m) => m.name)]) {
        const token = apiTokens[name]!
        for (const [toolName, args] of [
          ['docket_retire', { id: 'service.secret-beta', reason: 'leak' }],
          ['docket_update_notes', { id: 'service.secret-beta', additional_notes: 'leak', evidence: [{ source: 'human', note: 'leak' }] }],
          ['docket_supersede', { id: 'service.secret-beta', by: 'service.shared', reason: 'leak', evidence: [{ source: 'human', note: 'leak' }] }],
          ['docket_add_evidence', { supersession: betaProposal, evidence: [{ source: 'human', note: 'leak' }] }],
        ] as const) {
          const answer = await tool(token, 'alpha', toolName, args)
          expect(answer.text, `${name} ${toolName}`).not.toContain(MARK.beta)
        }
      }
      expect(await betaState()).toEqual(before)
    })
  })

  describe("the CLI's API, by bearer token", () => {
    const cliRoutes = async () => ({
      me: (await import('../../routes/api/o/[org]/w/[ws]/me/+server')).GET,
      documents: (await import('../../routes/api/o/[org]/w/[ws]/documents/+server')).GET,
      push: (await import('../../routes/api/o/[org]/w/[ws]/documents/push/+server')).POST,
      tokens: (await import('../../routes/api/o/[org]/w/[ws]/tokens/+server')).GET,
      mint: (await import('../../routes/api/o/[org]/w/[ws]/tokens/+server')).POST,
      revoke: (await import('../../routes/api/o/[org]/w/[ws]/tokens/[id]/+server')).DELETE,
    })

    it('answers an alpha token, API or OAuth, as if beta and the other account had no such workspace', async () => {
      const routes = await cliRoutes()
      const calls: [keyof typeof routes, string, string, object][] = [
        ['me', 'GET', '/me', {}],
        ['documents', 'GET', '/documents?origin=cloud&include=raw', {}],
        ['push', 'POST', '/documents/push', { body: { checkout: 'leak', upsert: [], remove: [] } }],
        ['tokens', 'GET', '/tokens', {}],
        ['mint', 'POST', '/tokens', { body: { scopes: ['docket:read'] } }],
        ['revoke', 'DELETE', `/tokens/${betaTokenId}`, { params: { id: betaTokenId } }],
      ]
      const before = await betaState()
      for (const name of ['owner', 'admin', ...GRANTED_ALPHA_ONLY.map((member) => member.name)]) {
        for (const token of [apiTokens[name]!, oauthTokens[name]!]) {
          for (const [ws, orgSlug] of [['beta', slug], ['alpha', other.slug]] as const) {
            for (const [route, method, path, options] of calls) {
              const event = bearerEvent(token, orgSlug, ws, `/api/o/${orgSlug}/w/${ws}${path}`, { method, ...options })
              const response = await routes[route](event as never)
              const body = await response.text()
              expect(response.status, `${name} ${orgSlug === slug ? ws : 'elsewhere'} ${route}`).toBe(404)
              expect(JSON.parse(body)).toMatchObject({ error: 'not_found' })
            }
          }
        }
      }
      expect(await betaState()).toEqual(before)
      const { rows } = await org.db.admin.query('SELECT revoked_at FROM platform.api_tokens WHERE id = $1', [betaTokenId])
      expect(rows).toEqual([{ revoked_at: null }])
    })

    it("lists and revokes alpha's own only, for an admin of alpha: never beta's documents or tokens", async () => {
      const routes = await cliRoutes()
      for (const member of GRANTED_ALPHA_ONLY.filter((m) => m.accountRole !== 'provisioner')) {
        const documents = await routes.documents(bearerEvent(apiTokens[member.name]!, slug, 'alpha', `/api/o/${slug}/w/alpha/documents?origin=cloud&include=raw`) as never)
        expect(documents.status).toBe(200)
        const listed = await documents.text()
        expect(listed).toContain(MARK.alpha)
        expect(listed).not.toContain(MARK.beta)
        expect(listed).not.toContain('secret-beta')

        const tokens = await routes.tokens(bearerEvent(oauthTokens[member.name]!, slug, 'alpha', `/api/o/${slug}/w/alpha/tokens`) as never)
        expect(tokens.status).toBe(200)
        expect(await tokens.text()).not.toContain(betaTokenId)

        // Beta's token named through alpha, by a member who manages alpha's tokens or only their own.
        const event = bearerEvent(oauthTokens[member.name]!, slug, 'alpha', `/api/o/${slug}/w/alpha/tokens/${betaTokenId}`, { method: 'DELETE', params: { id: betaTokenId } })
        const revoked = await routes.revoke(event as never)
        expect(revoked.status, member.name).toBe(404)
      }
      const { rows } = await org.db.admin.query('SELECT revoked_at FROM platform.api_tokens WHERE id = $1', [betaTokenId])
      expect(rows).toEqual([{ revoked_at: null }])
      // The control: beta's own token still reads beta.
      const me = await routes.me(bearerEvent(betaToken, slug, 'beta', `/api/o/${slug}/w/beta/me`) as never)
      expect(me.status).toBe(200)
    })
  })
})
