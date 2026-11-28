// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { acmeWorkspace, createOrg, signIn, unique } from './helpers'

/**
 * The API `docket cloud` (docket's M8 CLI) is built against: the device
 * authorization grant as the pre-registered `docket-cli` client, through
 * GitHub sign-in and the consent screen, then whoami, API tokens for CI, and
 * pushing, listing and pulling documents over `/api/o/{org}/w/{ws}/...` with
 * the bearer alone.
 */

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const CHECKOUT = 'docket-acme-platform-0123456789ab'
const hash = (raw: string) => `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`

let org = ''
/** The CLI's session: an OAuth access token for org/platform, from the device flow. */
let session = ''

const team = (slug: string, title: string) => `---
id: team.${slug}
type: team
title: ${title}
---

# ${title}

Pushed from a checkout.
`

const api = (request: APIRequestContext, method: 'GET' | 'POST' | 'DELETE', path: string, token: string, data?: unknown, ws = 'platform') =>
  request.fetch(`/api/o/${org}/w/${ws}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { data }),
  })

const poll = (request: APIRequestContext, deviceCode: string, resource: string) =>
  request.post('/oauth/token', { form: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: 'docket-cli', resource } })

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `CLI ${unique()}`)
  await acmeWorkspace(page, org, 'Platform')
  await acmeWorkspace(page, org, 'Data')
  await page.context().close()
})

test('the authorization server metadata offers the device grant', async ({ request, baseURL }) => {
  const metadata = (await (await request.get('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>
  expect(metadata.device_authorization_endpoint).toBe(`${baseURL}/oauth/device/auth`)
  expect(metadata.grant_types_supported).toContain(DEVICE_GRANT)
})

test('an unauthenticated call is 401 with the error field and the MCP challenge', async ({ request, baseURL }) => {
  const response = await request.get('/api/o/x/w/y/me')
  expect(response.status()).toBe(401)
  expect(await response.json()).toMatchObject({ error: 'invalid_token', error_description: expect.any(String) })
  expect(response.headers()['www-authenticate']).toBe(`Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp/x/y", scope="docket:read"`)
  // A route this server does not have answers SvelteKit's own 404, with no error field.
  const missing = await request.get('/api/o/x/w/y/nothing-here', { headers: { authorization: 'Bearer nonsense' } })
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('"error"')
})

test('docket cloud login: the device flow signs in with GitHub, shows the consent screen and issues tokens', async ({ browser, request, baseURL }) => {
  const resource = `${baseURL}/mcp/${org}/platform`
  const started = await request.post('/oauth/device/auth', { form: { client_id: 'docket-cli', scope: 'docket:read docket:write ontology:read ontology:propose', resource } })
  expect(started.status()).toBe(200)
  const device = (await started.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number }
  expect(device).toMatchObject({ verification_uri: `${baseURL}/oauth/device`, interval: 5 })
  expect(await (await poll(request, device.device_code, resource)).json()).toMatchObject({ error: 'authorization_pending' })

  // A browser that is not signed in yet opens the link the terminal printed.
  const page = await (await browser.newContext()).newPage()
  await page.goto(device.verification_uri_complete)
  await expect(page.getByRole('heading', { name: 'Sign in docket CLI?' })).toBeVisible()
  await expect(page.getByText(device.user_code)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/signin\?next=/)
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await page.getByLabel('Login').fill('alice')
  await page.getByRole('button', { name: 'Authorize' }).click()

  await expect(page).toHaveURL(/\/oauth\/consent\//)
  await expect(page.getByRole('heading', { name: 'Allow docket CLI?' })).toBeVisible()
  await expect(page.getByTestId('device-sign-in')).toContainText('the device that showed you the code')
  await expect(page.locator('p.workspace')).toContainText('/ Platform')
  await page.getByRole('button', { name: 'Allow' }).click()
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
  await page.context().close()

  const issued = await poll(request, device.device_code, resource)
  expect(issued.status()).toBe(200)
  const tokens = (await issued.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string }
  expect(tokens).toMatchObject({ expires_in: 900, token_type: 'Bearer', scope: 'docket:read docket:write ontology:read ontology:propose', refresh_token: expect.any(String) })
  session = tokens.access_token

  const me = await api(request, 'GET', 'me', session)
  expect(me.status()).toBe(200)
  expect(await me.json()).toMatchObject({
    login: 'alice',
    org,
    workspace: 'platform',
    role: 'owner',
    scopes: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'],
    token: { kind: 'oauth', expiresAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
  })

  // Refreshing rotates, as for any OAuth client.
  const refreshed = await request.post('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'docket-cli' } })
  expect(refreshed.status()).toBe(200)
  expect(((await refreshed.json()) as { refresh_token: string }).refresh_token).not.toBe(tokens.refresh_token)
})

test('docket cloud token: an OAuth session creates, lists and revokes CI tokens; a token never mints tokens', async ({ request }) => {
  expect(session).not.toBe('')
  const beyond = await api(request, 'POST', 'tokens', session, { scopes: ['docket:admin'] })
  expect(beyond.status()).toBe(400)
  expect(await beyond.json()).toMatchObject({ error: 'invalid_scope' })

  const created = await api(request, 'POST', 'tokens', session, { scopes: ['docket:read'], days: 7, description: 'ci' })
  expect(created.status()).toBe(201)
  const token = (await created.json()) as { id: string; token: string; prefix: string; read_only: boolean; scopes: string[]; expiresAt: string }
  // Read scopes from an older CLI make a read-only personal token for this docket.
  expect(token).toMatchObject({ id: expect.stringMatching(/^tok_/), read_only: true, scopes: ['docket:read', 'ontology:read'] })
  expect(token.token).toMatch(/^dkt_pat_[0-9A-Za-z]{43}_[0-9a-f]{8}$/)
  expect(token.token.startsWith(token.prefix)).toBe(true)
  expect(Math.round((Date.parse(token.expiresAt) - Date.now()) / 86_400_000)).toBe(7)

  const listed = (await (await api(request, 'GET', 'tokens', session)).json()) as { tokens: Record<string, unknown>[] }
  const entry = listed.tokens.find((candidate) => candidate.id === token.id)
  expect(entry).toMatchObject({ prefix: token.prefix, owner: '@alice', mine: true, readOnly: true, scopes: ['docket:read', 'ontology:read'], name: 'ci', description: 'ci', status: 'live', lastUsedAt: null })
  expect(JSON.stringify(listed)).not.toContain(token.token)

  // The API token works for what it carries, and gets 403 for tokens and for writes.
  const me = (await (await api(request, 'GET', 'me', token.token)).json()) as { token: { kind: string; id: string } }
  expect(me.token).toMatchObject({ kind: 'api', id: token.id })
  const mint = await api(request, 'POST', 'tokens', token.token, { scopes: ['docket:read'] })
  expect(mint.status()).toBe(403)
  expect(await mint.json()).toMatchObject({ error: 'insufficient_scope' })
  expect((await api(request, 'GET', 'tokens', token.token)).status()).toBe(403)
  const write = await api(request, 'POST', 'documents/push', token.token, { checkout: CHECKOUT, upsert: [], remove: [] })
  expect(write.status()).toBe(403)
  expect(await write.json()).toEqual({ error: 'insufficient_scope', error_description: 'This needs the docket:write scope.' })

  // Another workspace, or an org that is not this one, is not found: with the error field.
  const elsewhere = await api(request, 'GET', 'me', token.token, undefined, 'data')
  expect(elsewhere.status()).toBe(404)
  expect(await elsewhere.json()).toMatchObject({ error: 'not_found' })

  expect((await api(request, 'DELETE', `tokens/${token.id}`, session)).status()).toBe(204)
  const gone = await api(request, 'GET', 'me', token.token)
  expect(gone.status()).toBe(401)
  expect(await gone.json()).toMatchObject({ error: 'invalid_token' })
  const again = await api(request, 'DELETE', `tokens/${token.id}`, session)
  expect(again.status()).toBe(404)
  expect(await again.json()).toMatchObject({ error: 'not_found' })
})

test('docket cloud push, status and pull: cli documents keyed by the checkout, validated as one', async ({ request }) => {
  expect(session).not.toBe('')
  const upsert = [
    { path: '.docket/resources/teams/payments.md', raw: team('payments', 'Payments') },
    { path: '.docket/resources/teams/search.md', raw: team('search', 'Search') },
  ]
  const dry = await api(request, 'POST', 'documents/push', session, { checkout: CHECKOUT, dryRun: true, upsert, remove: [] })
  expect(dry.status()).toBe(200)
  expect(await dry.json()).toMatchObject({ ok: true, dryRun: true, created: upsert.map((file) => file.path), updated: [], unchanged: [], removed: [] })
  const status = async () => (await (await api(request, 'GET', `documents?origin=cli&originRef=${CHECKOUT}`, session)).json()) as { documents: Record<string, unknown>[]; next?: string }
  expect((await status()).documents).toEqual([])

  const pushed = await api(request, 'POST', 'documents/push', session, { checkout: CHECKOUT, upsert, remove: [] })
  expect(await pushed.json()).toMatchObject({ ok: true, dryRun: false, created: upsert.map((file) => file.path) })
  const listed = await status()
  expect(listed.next).toBeUndefined()
  expect(listed.documents).toEqual(
    upsert.map((file) => ({ path: file.path, hash: hash(file.raw), origin: 'cli', originRef: CHECKOUT, revision: 1, updatedAt: expect.any(String) })),
  )

  // An error anywhere refuses the whole batch.
  const refused = await api(request, 'POST', 'documents/push', session, {
    checkout: CHECKOUT,
    upsert: [
      { path: '.docket/resources/teams/payments.md', raw: team('payments', 'Payments, renamed') },
      { path: '.docket/resources/queues/orders.md', raw: '---\nid: queue.orders\ntype: queue\ntitle: Orders\n---\n' },
    ],
    remove: ['.docket/resources/teams/search.md'],
  })
  const body = (await refused.json()) as { ok: boolean; diagnostics: { severity: string; code: string; path?: string }[] }
  expect(body.ok).toBe(false)
  expect(body.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'unknown-type', path: '.docket/resources/queues/orders.md' }))
  expect((await status()).documents.map((document) => [document.path, document.revision])).toEqual(upsert.map((file) => [file.path, 1]))

  const removed = await api(request, 'POST', 'documents/push', session, { checkout: CHECKOUT, upsert: [], remove: ['.docket/resources/teams/search.md'] })
  expect(await removed.json()).toMatchObject({ ok: true, removed: ['.docket/resources/teams/search.md'] })
  expect((await status()).documents.map((document) => document.path)).toEqual(['.docket/resources/teams/payments.md'])

  // pull --resources: the cloud's own documents, with their text.
  const pulled = (await (await api(request, 'GET', 'documents?origin=cloud&include=raw', session)).json()) as { documents: { path: string; hash: string; raw?: string }[] }
  expect(pulled.documents.length).toBe(21)
  for (const document of pulled.documents) expect(hash(document.raw ?? '')).toBe(document.hash)
  const plain = (await (await api(request, 'GET', 'documents?origin=cloud', session)).json()) as { documents: Record<string, unknown>[] }
  expect(plain.documents[0]).not.toHaveProperty('raw')
})

test("a bearer call ignores the browser's session: no CSRF token is asked for", async ({ browser }) => {
  expect(session).not.toBe('')
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  await page.goto(`/a/${org}`)
  // The page's request context sends alice's session cookie, but no CSRF token and no Origin.
  const response = await page.request.post(`/api/o/${org}/w/platform/documents/push`, {
    headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
    data: { checkout: CHECKOUT, dryRun: true, upsert: [], remove: [] },
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, dryRun: true })
  await page.context().close()
})
