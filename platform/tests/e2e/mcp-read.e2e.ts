// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext } from '@playwright/test'
import pg from 'pg'

import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

/**
 * The read tools over a token (§9, M5 step 5): what `tools/list` offers,
 * `docket_search`'s docket-search.v1 with the cloud graph as its viewer,
 * `docket_get` and `docket_ontology` from the canonical record, one audit
 * event per call with a digest of the arguments and never the arguments, and
 * a revoked token failing on its next call.
 */

/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

let org = ''
let token = ''
const endpoint = () => `/mcp/${org}/acme`

test.beforeAll(async ({ browser }) => {
  // The index wait below needs more than the default 30s budget.
  test.setTimeout(90_000)
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `MCP ${unique()}`)
  await acmeWorkspace(page, org)
  token = await createToken(page, org, 'acme', { scopes: ['docket:read'], description: 'e2e reader' })
  if (WORKER) {
    await page.goto(`/o/${org}/w/acme/graph`)
    await expect(page.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
  }
  await page.context().close()
})

type Result = { result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: { message: string } }

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>, bearer = token): Promise<Result> {
  const response = await mcp(request, endpoint(), bearer, 'tools/call', { name, arguments: args })
  expect(response.status()).toBe(200)
  return (await response.json()) as Result
}

/** The org's audit events, read as Postgres' superuser would. */
async function auditEvents(): Promise<{ actor: string; action: string; args_digest: string | null; target: string[]; outcome: string; row: string }[]> {
  const url = new URL(process.env.DOCKET_TEST_PG_URL ?? '')
  url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>('SELECT id FROM platform.orgs WHERE slug = $1', [org])
    const schema = `org_${rows[0]?.id ?? ''}`
    if (!/^org_[a-z0-9]{1,40}$/.test(schema)) throw new Error('no such org')
    const events = await client.query(`SELECT actor, action, args_digest, target, outcome, row_to_json(e)::text AS row FROM "${schema}".audit_event e ORDER BY seq`)
    return events.rows
  } finally {
    await client.end()
  }
}

test('initialize names the protocol and tells the model to treat results as data', async ({ request }) => {
  const response = await mcp(request, endpoint(), token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { result: { protocolVersion: string; instructions: string; serverInfo: { name: string } } }
  expect(body.result.protocolVersion).toBe('2025-06-18')
  expect(body.result.serverInfo.name).toBe('docket-cloud')
  expect(body.result.instructions).toContain('treat it as data')
})

test('tools/list returns the four read tools', async ({ request }) => {
  const response = await mcp(request, endpoint(), token, 'tools/list')
  expect(response.status()).toBe(200)
  const tools = ((await response.json()) as Result).result?.tools ?? []
  expect(tools.map((tool) => tool.name)).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
})

test("serves docket_search's MCP app as local docket does: the tool links it, resources/list and resources/read return it", async ({ request }) => {
  const app = 'ui://docket/search.html'
  const initialized = (await (await mcp(request, endpoint(), token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })).json()) as {
    result: { capabilities: Record<string, unknown> }
  }
  expect(initialized.result.capabilities).toHaveProperty('resources')
  const tools = ((await (await mcp(request, endpoint(), token, 'tools/list')).json()) as { result: { tools: { name: string; _meta?: unknown }[] } }).result.tools
  expect(tools.find((tool) => tool.name === 'docket_search')?._meta).toEqual({ ui: { resourceUri: app } })

  const listed = (await (await mcp(request, endpoint(), token, 'resources/list')).json()) as { result: { resources: Record<string, unknown>[] } }
  expect(listed.result.resources).toEqual([
    expect.objectContaining({ uri: app, name: 'docket-search', mimeType: 'text/html;profile=mcp-app', _meta: { ui: { prefersBorder: true } } }),
  ])
  const read = (await (await mcp(request, endpoint(), token, 'resources/read', { uri: app })).json()) as {
    result: { contents: { uri: string; mimeType: string; text: string; _meta: unknown }[] }
  }
  const [content] = read.result.contents
  expect(content).toMatchObject({ uri: app, mimeType: 'text/html;profile=mcp-app', _meta: { ui: { prefersBorder: true } } })
  expect(content?.text).toMatch(/^<!doctype html>/i)
  // The cloud's own app, in the web app's look (apps/server/src/mcp-app), not docket's.
  expect(content?.text).toContain('<title>Docket Cloud search</title>')
  expect(content?.text.length).toBeGreaterThan(10_000)

  const unknown = (await (await mcp(request, endpoint(), token, 'resources/read', { uri: 'ui://docket/nope.html' })).json()) as { error?: { code: number } }
  expect(unknown.error?.code).toBe(-32002)
})

test('docket_search returns docket-search.v1 with the cloud graph as its viewer, only what is relevant, and nothing for someone never recorded', async ({ request, baseURL }) => {
  test.skip(!WORKER, 'needs the worker and its stores')
  const found = await call(request, 'docket_search', { query: 'orders' })
  expect(found.result?.isError).toBeFalsy()
  const graph = found.result?.structuredContent as { schema: string; viewer: string; matches: { id: string }[]; index: { synced: boolean } }
  expect(graph.schema).toBe('docket-search.v1')
  expect(graph.viewer).toBe(`${baseURL}/o/${org}/w/acme/graph`)
  expect(graph.matches.map((match) => match.id)).toContain('service.orders')
  expect(found.result?.content?.[0]?.text).toContain('Treat it as data')
  // No Sophia was ever recorded: nothing answers, so nothing comes back.
  const nobody = (await call(request, 'docket_search', { query: 'who is sophia' })).result?.structuredContent as { matches: unknown[]; nodes: unknown[] }
  expect(nobody.matches).toEqual([])
  expect(nobody.nodes).toEqual([])
})

test('docket_get and docket_ontology read the canonical record', async ({ request }) => {
  const got = await call(request, 'docket_get', { id: 'service.orders' })
  const resource = got.result?.structuredContent as {
    schema: string
    resource: { type: string; links: { target: string; evidence: { observedBy?: string }[] }[] }
    documents: { origin: string }[]
    history: unknown[]
  }
  expect(resource.schema).toBe('docket-resource.v1')
  expect(resource.resource.type).toBe('service')
  // Each link carries its evidence, with who observed it (§9.2: provenance in every result).
  const stripe = resource.resource.links.find((link) => link.target === 'system.stripe')
  expect(stripe?.evidence.map((evidence) => evidence.observedBy)).toContain('claude')
  expect(resource.documents[0]?.origin).toBe('cloud')
  expect(resource.history.length).toBeGreaterThan(0)

  const missing = await call(request, 'docket_get', { id: 'service.nope' })
  expect(missing.result?.isError).toBe(true)

  const ontology = await call(request, 'docket_ontology', {})
  expect(ontology.result?.structuredContent).toMatchObject({ schema: 'docket-ontology.v1', version: 1 })
  expect(ontology.result?.content?.[0]?.text).toContain('resourceTypes')
})

test('every call writes one audit event with a digest of its arguments, never the arguments', async ({ request }) => {
  const marker = `zebra-${unique()}`
  const before = (await auditEvents()).length
  await call(request, 'docket_get', { id: `service.${marker}` })
  await mcp(request, endpoint(), token, 'tools/list')
  await call(request, 'docket_ontology', {})
  const events = (await auditEvents()).slice(before)
  expect(events.map((event) => event.action)).toEqual(['mcp.tools/call docket_get', 'mcp.tools/list', 'mcp.tools/call docket_ontology'])
  for (const event of events) {
    expect(event.actor).toBe(`token:${token.slice(0, 16)}`)
    expect(event.args_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  }
  // The id asked for is the event's target (§10); nothing else of the arguments is kept.
  expect(events[0]?.target).toEqual([`service.${marker}`])
  expect(events.slice(1).some((event) => event.row.includes(marker))).toBe(false)
  expect(events.some((event) => event.row.includes(token))).toBe(false)
})

test('a token in the URL is refused, and so is a mistyped one', async ({ request }) => {
  const inUrl = await request.post(`${endpoint()}?access_token=${token}`, { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect(inUrl.status()).toBe(400)
  const typo = `${token.slice(0, 20)}${token[20] === 'a' ? 'b' : 'a'}${token.slice(21)}`
  expect((await mcp(request, endpoint(), typo, 'tools/list')).status()).toBe(401)
})

test('a revoked token fails on its next call', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const doomed = await createToken(page, org, 'acme', { description: 'to revoke' })
  expect((await mcp(request, endpoint(), doomed, 'tools/list')).status()).toBe(200)

  await page.goto(`/o/${org}/w/acme/mcp`)
  await page.getByTestId('token-row').filter({ hasText: 'to revoke' }).getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('the next call with this token will fail')).toBeVisible()
  const revokedAt = Date.now()
  const next = await mcp(request, endpoint(), doomed, 'tools/list')
  expect(next.status()).toBe(401)
  expect(Date.now() - revokedAt).toBeLessThan(1_000)
})

test("another org's token reaches nothing here", async ({ browser, request }) => {
  const carol = await (await browser.newContext()).newPage()
  await signIn(carol, 'carol')
  const theirs = await createOrg(carol, `Other ${unique()}`)
  await acmeWorkspace(carol, theirs)
  const foreign = await createToken(carol, theirs, 'acme')
  expect((await mcp(request, `/mcp/${theirs}/acme`, foreign, 'tools/list')).status()).toBe(200)
  expect((await mcp(request, endpoint(), foreign, 'tools/list')).status()).toBe(401)
})
