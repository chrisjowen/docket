// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { acmeWorkspace, createOrg, signIn, unique } from './helpers'

/**
 * MCP OAuth consent is capped at the signed-in member's namespace permission
 * (tenancy design §5.1, phase 2b), not just their org role: a read-only
 * member's consent screen offers no write scope, however much the client
 * asks for, and approving carries only what was offered.
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

test('a read-only member is offered docket:read only over MCP OAuth, even when the client asks for docket:write', async ({
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
    await owner.locator('form[action="?/invite"] select[name="role"]').selectOption('viewer')
    await owner.getByRole('button', { name: 'Send invite' }).click()
    await expect(owner.getByText(`Invited @${dana} as viewer.`)).toBeVisible()

    const danaPage = await (await browser.newContext()).newPage()
    await signIn(danaPage, dana, { name: 'Dana Diaz' })
    await danaPage.getByRole('button', { name: `Accept and join Acme ${suffix}` }).click()
    await expect(danaPage.getByTestId('my-role')).toHaveText('viewer')

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

    // docket:write and ontology:propose are offered but unticked and disabled; docket:read and ontology:read are checked.
    const write = danaPage.getByRole('checkbox', { name: /docket:write/ })
    const propose = danaPage.getByRole('checkbox', { name: /ontology:propose/ })
    const read = danaPage.getByRole('checkbox', { name: /docket:read/ })
    await expect(write).toBeDisabled()
    await expect(write).not.toBeChecked()
    await expect(propose).toBeDisabled()
    await expect(read).toBeChecked()
    await expect(read).toBeEnabled()

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
    // Only what the read-only member's permission allows made it into the grant, however much was requested.
    expect(tokens.scope.split(' ').sort()).toEqual(['docket:read', 'ontology:read'])
  } finally {
    callback.close()
  }
})
