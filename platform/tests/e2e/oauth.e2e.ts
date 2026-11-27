// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { acmeWorkspace, createOrg, mcp, signIn, unique } from './helpers'

/**
 * MCP over OAuth (§8.2, M5 step 3): discovery from the 401, the authorization
 * server's metadata, and the authorization code flow with PKCE and a resource
 * indicator, through GitHub sign-in and the consent screen, to an access
 * token for one workspace only.
 */

let org = ''
/** The client's local listener, which the authorization server sends the browser back to. */
let callback: Server
let redirectUri = ''
test.beforeAll(async ({ browser }) => {
  callback = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('callback'))
  await new Promise<void>((resolve) => callback.listen(0, '127.0.0.1', resolve))
  redirectUri = `http://127.0.0.1:${(callback.address() as AddressInfo).port}/callback`

  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `OAuth ${unique()}`)
  await acmeWorkspace(page, org, 'Platform')
  await acmeWorkspace(page, org, 'Data')
  await page.context().close()
})

test.afterAll(() => {
  callback?.close()
})

async function register(request: APIRequestContext, redirectUri: string, name = 'e2e client'): Promise<string> {
  const response = await request.post('/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { client_id: string }).client_id
}

function authorizeUrl(clientId: string, redirectUri: string, resource: string, verifier: string): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'docket:read',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource,
    state: 'e2e-state',
  })
  return `/oauth/authorize?${query}`
}

const backAtCallback = () => new RegExp(`^${redirectUri.replace(/[.?]/g, '\\$&')}\\?`)

test('an unauthenticated POST gives 401 pointing at the resource metadata', async ({ request, baseURL }) => {
  const response = await request.post('/mcp/acme/platform', { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })
  expect(response.status()).toBe(401)
  expect(response.headers()['www-authenticate']).toBe(
    `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp/acme/platform", scope="docket:read"`,
  )
})

test('the resource metadata names the authorization server, which offers S256 and client metadata documents', async ({ request, baseURL }) => {
  const prm = (await (await request.get(`/.well-known/oauth-protected-resource/mcp/${org}/platform`)).json()) as Record<string, unknown>
  expect(prm).toMatchObject({
    resource: `${baseURL}/mcp/${org}/platform`,
    authorization_servers: [baseURL],
    scopes_supported: ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose', 'ontology:write'],
  })
  const as = (await (await request.get('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>
  expect(as).toMatchObject({
    issuer: baseURL,
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    registration_endpoint: `${baseURL}/oauth/register`,
    token_endpoint: `${baseURL}/oauth/token`,
  })
})

test('code + PKCE + resource gives a token for this workspace only', async ({ browser, request, baseURL }) => {
  const clientId = await register(request, redirectUri)
  const resource = `${baseURL}/mcp/${org}/platform`
  const verifier = randomBytes(32).toString('base64url')

  // A browser with no session: the consent page sends it through GitHub sign-in first.
  const page = await (await browser.newContext()).newPage()
  await page.goto(authorizeUrl(clientId, redirectUri, resource, verifier))
  await expect(page).toHaveURL(/\/signin\?next=%2Foauth%2Fconsent%2F/)
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await page.getByLabel('Login').fill('alice')
  await page.getByRole('button', { name: 'Authorize' }).click()

  await expect(page.getByRole('heading', { name: 'Allow e2e client?' })).toBeVisible()
  await expect(page.locator('p.workspace')).toContainText('/ Platform')
  await expect(page.getByRole('checkbox', { name: /docket:read/ })).toBeChecked()
  await page.getByRole('button', { name: 'Allow' }).click()
  await page.waitForURL(backAtCallback())
  const back = new URL(page.url())
  expect(back.searchParams.get('state')).toBe('e2e-state')
  const code = back.searchParams.get('code') ?? ''
  expect(code).not.toBe('')

  const exchanged = await request.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource },
  })
  expect(exchanged.status()).toBe(200)
  const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string }
  expect(tokens).toMatchObject({ expires_in: 900, scope: 'docket:read' })
  expect(tokens.refresh_token).toBeTruthy()

  const listed = await mcp(request, `/mcp/${org}/platform`, tokens.access_token, 'tools/list')
  expect(listed.status()).toBe(200)
  const names = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)
  expect(names).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])

  // Its audience is this workspace's MCP URL: another workspace refuses it.
  const elsewhere = await mcp(request, `/mcp/${org}/data`, tokens.access_token, 'tools/list')
  expect(elsewhere.status()).toBe(401)
  expect(elsewhere.headers()['www-authenticate']).toContain('error="invalid_token"')

  // The grant shows on the workspace's MCP page, and the call in its audit.
  await page.goto(`/o/${org}/w/platform/mcp`)
  await expect(page.getByTestId('grant-row')).toContainText('e2e client')
  await expect(page.getByTestId('audit-row').filter({ hasText: 'oauth.grant' }).first()).toContainText(clientId)
  await expect(page.getByTestId('audit-row').filter({ hasText: 'mcp.tools/list' }).first()).toContainText(`@alice via ${clientId}`)

  // Revoking the grant ends its tokens on the next call.
  await page.getByTestId('grant-row').getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('the next call with this client')).toBeVisible()
  expect((await mcp(request, `/mcp/${org}/platform`, tokens.access_token, 'tools/list')).status()).toBe(401)
  const refreshed = await request.post('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId } })
  expect(refreshed.status()).toBe(400)
})

test('localhost redirect shows warning', async ({ browser, request, baseURL }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const resource = `${baseURL}/mcp/${org}/platform`

  // A redirect to this machine: any local program could be the one asking.
  const local = await register(request, redirectUri, 'Claude Code')
  await page.goto(authorizeUrl(local, redirectUri, resource, randomBytes(32).toString('base64url')))
  await expect(page.getByTestId('redirect-host')).toContainText(new URL(redirectUri).host)
  await expect(page.getByTestId('local-app-warning')).toContainText('Local app')

  // Denying sends the client access_denied.
  await page.getByRole('button', { name: 'Deny' }).click()
  await page.waitForURL(backAtCallback())
  expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied')

  // A web client's redirect: its host, prominently, and no warning.
  const web = await register(request, 'https://client.example/oauth/callback', 'Web client')
  await page.goto(authorizeUrl(web, 'https://client.example/oauth/callback', resource, randomBytes(32).toString('base64url')))
  await expect(page.getByTestId('redirect-host')).toContainText('client.example')
  await expect(page.getByTestId('local-app-warning')).toHaveCount(0)
})

test("a consent link opened in another browser shows nothing", async ({ browser, request, baseURL }) => {
  const clientId = await register(request, redirectUri)
  const starter = await (await browser.newContext()).newPage()
  await signIn(starter, 'alice')
  await starter.goto(authorizeUrl(clientId, redirectUri, `${baseURL}/mcp/${org}/platform`, randomBytes(32).toString('base64url')))
  await expect(starter.getByRole('heading', { name: 'Allow e2e client?' })).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, 'alice')
  const response = await other.goto(starter.url())
  expect(response?.status()).toBe(404)
})
