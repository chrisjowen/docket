// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * Direct ontology changes over MCP: Publish ontology changes is a capability,
 * given person by person on a docket's Access tab (tenancy v2 §3.1). Whoever
 * holds it publishes from an MCP client, breaking and migrating changes
 * included, with no review. It is read on every call, and every change is in
 * the history, where it rolls back.
 */

type Result = {
  result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
}

let org = ''
let alice: Page
let bob: Page
const bobLogin = `bob${unique()}`
const ws = () => `/a/${org}/d/acme`
const endpoint = () => `/mcp/${org}/acme`

async function call(request: APIRequestContext, token: string, name: string, args: Record<string, unknown>): Promise<Result> {
  const response = await mcp(request, endpoint(), token, 'tools/call', { name, arguments: args })
  expect(response.status()).toBe(200)
  return (await response.json()) as Result
}

async function tools(request: APIRequestContext, token: string): Promise<string[]> {
  const listed = (await (await mcp(request, endpoint(), token, 'tools/list')).json()) as Result
  return listed.result?.tools?.map((tool) => tool.name) ?? []
}

/** The owner gives Bob Writer + Publish ontology changes on this docket, or takes that grant away. */
async function letBobPublish(on: boolean) {
  await alice.goto(`${ws()}/access`)
  if (on) {
    const form = alice.getByTestId('give-access')
    const bobId = await form.locator('select[name="who"] option', { hasText: bobLogin }).getAttribute('value')
    await form.locator('select[name="who"]').selectOption(bobId ?? '')
    await form.getByTestId('role-select').selectOption('writer')
    await form.getByText('Adjust capabilities').click()
    await form.getByLabel('Publish ontology changes').check()
    await form.getByRole('button', { name: 'Give access' }).click()
    await expect(alice.getByRole('status')).toContainText(`${bobLogin} now has Writer + Publish ontology changes`)
  } else {
    await alice.getByRole('list', { name: 'Grants on this docket' }).locator(`li[data-who="${bobLogin}"]`).getByRole('button', { name: /^Remove / }).click()
    await expect(alice.getByRole('status')).toContainText(`${bobLogin} no longer has`)
  }
}

test.beforeAll(async ({ browser }) => {
  alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  org = await createOrg(alice, `Ontology MCP ${unique()}`)
  await acmeWorkspace(alice, org)
  await alice.goto(`/a/${org}/members`)
  await alice.getByLabel('GitHub login or email').fill(`@${bobLogin}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('writer')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  bob = await (await browser.newContext()).newPage()
  await signIn(bob, bobLogin)
  await bob.getByRole('button', { name: /^Accept and join/ }).click()
  await expect(bob.getByTestId('my-role')).toHaveText('Writer on General')
})

test.afterAll(async () => {
  await alice?.context().close()
  await bob?.context().close()
})

test('only someone who manages access gives Publish, and a token publishes only while its owner holds it', async ({ request }) => {
  // A writer's token proposes, and cannot publish.
  const writers = await createToken(bob, org, 'acme', { scopes: ['docket:read', 'docket:write'], description: 'e2e writer' })
  expect(await tools(request, writers)).not.toContain('docket_publish_ontology_change')
  // Bob sees his own access on the Access tab, and cannot give any.
  await bob.goto(`${ws()}/access`)
  await expect(bob.getByTestId('your-access')).toContainText('Can write')
  await expect(bob.getByTestId('give-access')).toHaveCount(0)
  // The Access tab gives access through the API (grants.create), which refuses him as the page does.
  const refused = await bob.request.post(`/api/v1/accounts/${org}/grants`, {
    data: { who: 'everyone', place: 'docket:acme', role: 'admin' },
    headers: { 'x-csrf-token': await csrfOf(bob), origin: new URL(bob.url()).origin },
  })
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toMatchObject({ error: 'forbidden' })

  // The owner gives Bob alone Publish ontology changes on this docket.
  await letBobPublish(true)
  await expect(alice.getByRole('list', { name: 'Grants on this docket' }).locator(`li[data-who="${bobLogin}"]`)).toContainText('Writer + Publish ontology changes')
  // A token acts as its owner: Bob's same token publishes from its next call. The owner holds every capability.
  expect(await tools(request, writers)).toContain('docket_publish_ontology_change')
  const owners = await createToken(alice, org, 'acme', { scopes: ['docket:read', 'docket:write', 'ontology:write'], description: 'e2e owner' })
  expect(await tools(request, owners)).toContain('docket_publish_ontology_change')
})

test("a publisher's ontology:write token publishes and migrates over MCP, rolls back from the history, and stops when the grant goes", async ({ request }) => {
  await letBobPublish(true)
  const token = await createToken(bob, org, 'acme', { scopes: ['docket:read', 'ontology:propose', 'ontology:write'], description: 'e2e ontology writer' })
  expect(await tools(request, token)).toContain('docket_publish_ontology_change')

  const added = await call(request, token, 'docket_publish_ontology_change', { patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n', message: 'Add queues' })
  expect(added.result?.isError).toBeUndefined()
  expect(added.result?.structuredContent).toMatchObject({ schema: 'docket-ontology-publish.v1', version: 2, previous: 1, classification: 'safe' })

  // It is in the history, marked as published over MCP, and rolls back from there: v3 equals v1.
  await alice.goto(`${ws()}/ontology/history`)
  await expect(alice.locator('li[data-version="2"]')).toContainText('via MCP')
  await expect(alice.locator('li[data-version="2"]')).toContainText('Add queues')
  await alice.getByRole('button', { name: 'Roll back to v1' }).click()
  await expect(alice.getByText('Published v3.')).toBeVisible()
  const v1 = await (await alice.request.get(`${ws()}/ontology/export?v=1`)).text()
  const v3 = await (await alice.request.get(`${ws()}/ontology/export?v=3`)).text()
  expect(v3.split('\n').slice(1).join('\n')).toBe(v1.split('\n').slice(1).join('\n'))

  // Renaming a type in use is breaking: refused without a migration, published with one, the document rewritten.
  const rename = {
    patch:
      'resourceTypes:\n  feature_flag: null\n  flag:\n    description: A runtime switch.\n    attributes:\n      key:\n        type: string\n' +
      '      rollout:\n        type: string\n      temporary:\n        type: boolean\nrelationships:\n  guarded_by:\n    to:\n      - flag\n',
    acceptNarrowing: true,
    expectedHead: 3,
  }
  const broken = await call(request, token, 'docket_publish_ontology_change', rename)
  expect(broken.result?.isError).toBe(true)
  expect(broken.result?.content?.[0]?.text).toContain('Nothing was published')
  const migrated = await call(request, token, 'docket_publish_ontology_change', { ...rename, migration: [{ op: 'renameType', from: 'feature_flag', to: 'flag' }] })
  expect(migrated.result?.isError).toBeUndefined()
  expect(migrated.result?.structuredContent).toMatchObject({ version: 4, previous: 3, rewritten: [{ resourceId: 'feature_flag.checkout-rewrite', revision: 2 }] })
  await alice.goto(`${ws()}/ontology/history`)
  await expect(alice.locator('li[data-version="4"]')).toContainText('renameType feature_flag -> flag')

  // Every call and every change to who may publish are in the audit log.
  await alice.goto(`/a/${org}/audit`)
  await expect(alice.getByRole('cell', { name: 'mcp.tools/call docket_publish_ontology_change' }).first()).toBeVisible()
  // The Access tab changes grants through the API, recorded as its operations.
  await expect(alice.getByRole('cell', { name: /^api\.grants\.(create|replace)$/ }).first()).toBeVisible()

  // Taken away: the same token loses the tool on its very next call, and can still propose.
  await letBobPublish(false)
  expect(await tools(request, token)).not.toContain('docket_publish_ontology_change')
  expect(await tools(request, token)).toContain('docket_propose_ontology_change')
  const off = await mcp(request, endpoint(), token, 'tools/call', { name: 'docket_publish_ontology_change', arguments: { patch: 'resourceTypes:\n  topic:\n    description: A topic.\n' } })
  expect(off.status()).toBe(403)
  expect(off.headers()['www-authenticate']).toContain('insufficient_scope')
})
