// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * Direct ontology changes over MCP: the workspace's owner chooses the roles
 * whose `ontology:write` credentials may publish the ontology from an MCP
 * client, breaking and migrating changes included, with no review. The
 * setting is checked on every call, and every change is in the history,
 * where it rolls back.
 */

type Result = {
  result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
}

let org = ''
let alice: Page
let bob: Page
const bobLogin = `bob${unique()}`
const ws = () => `/o/${org}/w/acme`
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

/** The owner ticks exactly `roles` in the workspace's settings. */
async function allow(roles: string[]) {
  await alice.goto(`${ws()}/settings`)
  const form = alice.getByTestId('ontology-mcp')
  for (const role of ['Owners', 'Admins', 'Editors']) {
    const box = form.getByLabel(role)
    if (roles.includes(role)) await box.check()
    else await box.uncheck()
  }
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(alice.getByRole('status')).toContainText('Saved')
}

test.beforeAll(async ({ browser }) => {
  alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  org = await createOrg(alice, `Ontology MCP ${unique()}`)
  await acmeWorkspace(alice, org)
  await alice.goto(`/o/${org}/members`)
  await alice.getByLabel('GitHub login or email').fill(`@${bobLogin}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('editor')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  bob = await (await browser.newContext()).newPage()
  await signIn(bob, bobLogin)
  await bob.getByRole('button', { name: /^Accept and join/ }).click()
  await expect(bob.getByTestId('my-role')).toHaveText('editor')
})

test.afterAll(async () => {
  await alice?.context().close()
  await bob?.context().close()
})

test('only the owner changes the setting, and a token publishes only while it names its owner’s role', async ({ request }) => {
  // Off by default: an editor's token proposes, and cannot publish.
  const editors = await createToken(bob, org, 'acme', { scopes: ['docket:read', 'docket:write'], description: 'e2e editor' })
  expect(await tools(request, editors)).not.toContain('docket_publish_ontology_change')
  await bob.goto(`${ws()}/settings`)
  await expect(bob.getByTestId('ontology-mcp').getByLabel('Editors')).toBeDisabled()
  await expect(bob.getByText("Only the organisation's owner changes this.")).toBeVisible()
  const refused = await bob.request.post(`${ws()}/settings?/ontologyMcp`, {
    form: { csrf: await csrfOf(bob), role: 'editor' },
    headers: { origin: new URL(bob.url()).origin },
  })
  expect(refused.status()).toBe(403)

  // The owner lets editors, not owners: role by role.
  await allow(['Editors'])
  await alice.reload()
  await expect(alice.getByTestId('ontology-mcp').getByLabel('Editors')).toBeChecked()
  await expect(alice.getByTestId('ontology-mcp').getByLabel('Owners')).not.toBeChecked()
  // A token acts as its owner: the editor's same token publishes from its next call, the owner's does not.
  expect(await tools(request, editors)).toContain('docket_publish_ontology_change')
  const owners = await createToken(alice, org, 'acme', { scopes: ['docket:read', 'docket:write'], description: 'e2e owner' })
  expect(await tools(request, owners)).not.toContain('docket_publish_ontology_change')
})

test("an editor's ontology:write token publishes and migrates over MCP, rolls back from the history, and stops when the owner turns it off", async ({ request }) => {
  await allow(['Editors'])
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

  // Every call and the setting's changes are in the audit log.
  await alice.goto(`/o/${org}/audit`)
  await expect(alice.getByRole('cell', { name: 'mcp.tools/call docket_publish_ontology_change' }).first()).toBeVisible()
  await expect(alice.getByRole('cell', { name: 'workspace.ontology-mcp' }).first()).toBeVisible()

  // Turned off: the same token loses the tool on its very next call, and can still propose.
  await allow([])
  expect(await tools(request, token)).not.toContain('docket_publish_ontology_change')
  expect(await tools(request, token)).toContain('docket_propose_ontology_change')
  const off = await mcp(request, endpoint(), token, 'tools/call', { name: 'docket_publish_ontology_change', arguments: { patch: 'resourceTypes:\n  topic:\n    description: A topic.\n' } })
  expect(off.status()).toBe(403)
  expect(off.headers()['www-authenticate']).toContain('insufficient_scope')
})
