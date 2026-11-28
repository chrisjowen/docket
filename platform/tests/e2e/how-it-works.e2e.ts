// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * Settings → Sync and Settings → Queries: how the documents reach the stores
 * and how questions are answered, read-only for every member; a member who is
 * not an owner or admin sees only their own questions, and only an owner may
 * ask for a re-check.
 */

/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

let org = ''
let viewer = ''
let owner: Page
let member: Page

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  const suffix = unique()
  viewer = `vera${suffix}`
  owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'alice')
  org = await createOrg(owner, `Sync ${suffix}`)
  await owner.getByLabel('GitHub login or email').fill(`@${viewer}`)
  await owner.locator('form[action="?/invite"] select[name="role"]').selectOption('reader')
  await owner.getByRole('button', { name: 'Send invite' }).click()
  await expect(owner.getByText(`@${viewer} is invited as Reader on`)).toBeVisible()
  await acmeWorkspace(owner, org)
  if (WORKER) {
    await owner.goto(`/a/${org}/d/acme/graph`)
    await expect(owner.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
  }
  member = await (await browser.newContext()).newPage()
  await signIn(member, viewer)
  await member.getByRole('button', { name: `Accept and join Sync ${suffix}` }).click()
  await expect(member).toHaveURL(new RegExp(`/a/${org}$`))
})

test.afterAll(async () => {
  await owner?.context().close()
  await member?.context().close()
})

test('Settings has General, Sync and Queries, under the workspace’s Settings tab', async () => {
  await owner.goto(`/a/${org}/d/acme/settings`)
  const tabs = owner.getByRole('navigation', { name: 'Settings' })
  await expect(tabs.getByRole('link')).toHaveText(['General', 'Sync', 'Queries'])
  await tabs.getByRole('link', { name: 'Sync' }).click()
  await expect(owner).toHaveURL(new RegExp(`/a/${org}/d/acme/settings/sync$`))
  await expect(owner.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
})

test('Sync shows each store and the passes that projected the documents, by id', async () => {
  test.skip(!WORKER, 'needs the worker and its stores')
  await owner.goto(`/a/${org}/d/acme/settings/sync`)
  await expect(owner.getByTestId('store-documents')).toContainText('documents')
  for (const store of ['neo4j', 'mem0']) {
    await expect(owner.getByTestId(`store-${store}`)).toHaveAttribute('data-state', 'current')
    await expect(owner.getByTestId(`lag-${store}`)).toHaveText('none')
  }
  const pass = owner.getByTestId('sync-run').filter({ hasText: 'documents changed' }).last()
  await expect(pass).toHaveAttribute('data-ok', 'true')
  await pass.getByTestId('sync-run-neo4j').getByText('What changed').click()
  await expect(pass.getByTestId('sync-run-neo4j')).toContainText('team.')
  await expect(owner.getByTestId('store-documents')).not.toContainText('none recorded')
})

test('Queries replays a search step by step: the stores asked, the template query, and that it cost nothing', async ({ request }) => {
  test.skip(!WORKER, 'needs the worker and its stores')
  const token = await createToken(owner, org, 'acme', { scopes: ['docket:read'], description: 'e2e how-it-works' })
  const question = `checkout ${unique()}`
  const response = await mcp(request, `/mcp/${org}/acme`, token, 'tools/call', { name: 'docket_search', arguments: { query: question } })
  expect(response.status()).toBe(200)

  // An owner sees every question asked of the workspace.
  await owner.goto(`/a/${org}/d/acme/settings/queries`)
  await expect(owner.getByTestId('queries-whose')).toContainText('Every question anyone asked')
  const trace = owner.getByTestId('query-trace').filter({ hasText: question })
  await expect(trace).toHaveAttribute('data-tool', 'search')
  await expect(trace.getByTestId('trace-store-neo4j').getByTestId('query-by')).toHaveText('Template: a fixed query, no model wrote it')
  await expect(trace.getByTestId('trace-store-neo4j').getByTestId('query-text')).toContainText('fulltext')
  await expect(trace.getByTestId('trace-store-mem0')).toHaveAttribute('data-state', 'answered')
  await expect(trace.getByTestId('trace-cost')).toContainText('search never calls one')
})

test("a viewer sees only the questions they asked; the owner sees theirs and the viewer's", async ({ request }) => {
  test.skip(!WORKER, 'needs the worker and its stores')
  const ownerToken = await createToken(owner, org, 'acme', { scopes: ['docket:read'], description: 'e2e owner asks' })
  const viewerToken = await createToken(member, org, 'acme', { scopes: ['docket:read'], description: 'e2e viewer asks' })
  const ownersQuestion = `owners ${unique()}`
  const viewersQuestion = `viewers ${unique()}`
  for (const [token, query] of [
    [ownerToken, ownersQuestion],
    [viewerToken, viewersQuestion],
  ] as const) {
    const response = await mcp(request, `/mcp/${org}/acme`, token, 'tools/call', { name: 'docket_search', arguments: { query } })
    expect(response.status()).toBe(200)
  }

  await member.goto(`/a/${org}/d/acme/settings/queries`)
  await expect(member.getByTestId('queries-whose')).toContainText('Only the questions you asked')
  await expect(member.getByTestId('query-trace').filter({ hasText: viewersQuestion })).toHaveCount(1)
  await expect(member.getByTestId('query-trace').filter({ hasText: ownersQuestion })).toHaveCount(0)

  await owner.goto(`/a/${org}/d/acme/settings/queries`)
  await expect(owner.getByTestId('query-trace').filter({ hasText: viewersQuestion })).toHaveCount(1)
  await expect(owner.getByTestId('query-trace').filter({ hasText: ownersQuestion })).toHaveCount(1)
})

test('only an owner may ask for a re-check: the button, and the action around it', async () => {
  await member.goto(`/a/${org}/d/acme/settings/sync`)
  await expect(member.getByTestId('recheck')).toHaveCount(0)
  await expect(member.getByText('Only owners can ask for a re-check.')).toBeVisible()
  const refused = await member.request.post(`/a/${org}/d/acme/settings/sync?/recheck`, {
    form: { csrf: await csrfOf(member) },
    headers: { origin: new URL(member.url()).origin },
  })
  expect(refused.status()).toBe(403)

  await owner.goto(`/a/${org}/d/acme/settings/sync`)
  await owner.getByTestId('recheck').click()
  await expect(owner.getByRole('status').filter({ hasText: 'Re-check requested' })).toBeVisible()
  if (WORKER) {
    await expect(owner.getByTestId('sync-run').filter({ hasText: 're-check requested' }).first()).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
  }
})
