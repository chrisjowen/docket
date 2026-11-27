// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { acmeWorkspace, createOrg, mcp, signIn, unique } from './helpers'

/**
 * An MCP OAuth connection acts as the member who approved it (tenancy v2
 * §3.4), at their permission on the docket, not just their org role: a
 * read-only member's connection only reads, however much the client asks for.
 */

async function register(request: APIRequestContext, redirectUri: string, name: string): Promise<string> {
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

test('a read-only member’s connection only reads over MCP OAuth, even when the client asks for docket:write', async ({
  browser,
  request,
  baseURL,
}) => {
  const suffix = unique()
  const dana = `dana${suffix}`

  const callback = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('callback'))
  await new Promise<void>((resolve) => callback.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(callback.address() as AddressInfo).port}/callback`
  const backAtCallback = () => new RegExp(`^${redirectUri.replace(/[.?]/g, '\\$&')}\\?`)

  try {
    const owner = await (await browser.newContext()).newPage()
    await signIn(owner, 'alice', { name: 'Alice Archer' })
    const org = await createOrg(owner, `Acme ${suffix}`)
    const ws = await acmeWorkspace(owner, org, 'Platform')

    await owner.goto(`/o/${org}/members`)
    await owner.getByLabel('GitHub login or email').fill(`@${dana}`)
    await owner.locator('form[action="?/invite"] select[name="role"]').selectOption('reader')
    await owner.getByRole('button', { name: 'Send invite' }).click()
    await expect(owner.getByText(`Invited @${dana} as Reader on`)).toBeVisible()

    const danaPage = await (await browser.newContext()).newPage()
    await signIn(danaPage, dana, { name: 'Dana Diaz' })
    await danaPage.getByRole('button', { name: `Accept and join Acme ${suffix}` }).click()
    await expect(danaPage.getByTestId('my-role')).toHaveText('Reader')

    const clientId = await register(request, redirectUri, 'readonly e2e client')
    const resource = `${baseURL}/mcp/${org}/${ws}`
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'docket:read docket:write ontology:read ontology:propose',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
      state: 'readonly-state',
    })
    await danaPage.goto(`/oauth/authorize?${query}`)
    await expect(danaPage.getByRole('heading', { name: 'Allow readonly e2e client?' })).toBeVisible()

    // No scopes to choose: the consent says she only reads this docket, so the connection does too.
    await expect(danaPage.getByText('You only read this docket anyway.')).toBeVisible()
    await expect(danaPage.getByRole('checkbox', { name: /docket:write/ })).toHaveCount(0)

    await danaPage.getByRole('button', { name: 'Allow' }).click()
    await danaPage.waitForURL(backAtCallback())
    const back = new URL(danaPage.url())
    expect(back.searchParams.get('state')).toBe('readonly-state')
    const code = back.searchParams.get('code') ?? ''
    expect(code).not.toBe('')

    const exchanged = await request.post('/oauth/token', {
      form: { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource },
    })
    expect(exchanged.status()).toBe(200)
    const tokens = (await exchanged.json()) as { access_token: string; scope: string }
    // The connection acts as her: only her reading tools, and a write is refused, however much was requested.
    const listed = await mcp(request, `/mcp/${org}/${ws}`, tokens.access_token, 'tools/list')
    const names = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)
    expect(names).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    const write = await mcp(request, `/mcp/${org}/${ws}`, tokens.access_token, 'tools/call', { name: 'docket_remember', arguments: {} })
    expect(write.status()).toBe(403)
  } finally {
    callback.close()
  }
})
