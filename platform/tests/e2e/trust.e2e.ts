// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * Trust set by policy (the docket trust design, P4): what the org attests
 * about sources - a person's role, a registered document - prices evidence
 * through the workspace's policies, an agent's evidence is its person's, and
 * docket_supersede files a scored proposal that becomes fact only when it
 * clears its bar, by score, a confirmation or an admin's override.
 */

const ONTOLOGY = `version: 1
resourceTypes:
  decision:
    description: A decision the team made.
relationships: {}
sources:
  person:
    kind: identity
    attributes:
      role: { type: string, setBy: directory }
  document:
    kind: content
    identifiedBy: [url]
    attributes:
      status: { type: string, setBy: registry }
    locator:
      url: { required: true }
trust:
  accept: { default: 0.75, decision: 0.8 }
  policies:
    - name: A person said so
      when: { source: person }
      score: 0.5
    - name: A lead said so
      when: { source: person, role: lead }
      score: 0.85
    - name: A document
      when: { source: document }
      score: 0.4
    - name: A verified document
      when: { source: document, status: verified }
      score: 0.9
`

// Each test builds on the one before: one org, one workspace, one directory.
test.describe.configure({ mode: 'serial' })

type Result = { result?: { content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean } }

let org = ''
let token = ''
let page: Page
const endpoint = () => `/mcp/${org}/decisions`
const call = async (request: APIRequestContext, name: string, args: Record<string, unknown>): Promise<Result> => {
  const response = await mcp(request, endpoint(), token, 'tools/call', { name, arguments: args })
  expect(response.status()).toBe(200)
  return (await response.json()) as Result
}
const api = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, data?: unknown) => {
  const response = await page.request.fetch(path, {
    method,
    ...(data !== undefined ? { data } : {}),
    headers: method === 'GET' ? {} : { 'x-csrf-token': await csrfOf(page) },
  })
  return { status: response.status(), body: response.status() === 204 ? null : ((await response.json()) as Record<string, unknown>) }
}
const decide = async (request: APIRequestContext, id: string, by: string) => {
  for (const [each, title] of [
    [id, `Decision ${id}`],
    [by, `Decision ${by}`],
  ]) {
    const written = await call(request, 'docket_remember', { id: each, type: 'decision', title, evidence: [{ note: 'Agreed at the review.' }] })
    expect(written.result?.isError, JSON.stringify(written.result?.content)).toBeFalsy()
  }
  return call(request, 'docket_supersede', { id, by, reason: 'The team changed its mind.', evidence: [{ note: 'Said at the retro.' }] })
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Trust ${unique()}`)
  await page.goto(`/a/${org}/dockets/new`)
  await page.getByLabel('Name').fill('Decisions')
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: Buffer.from(ONTOLOGY) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${org}/d/decisions/ontology$`))
  token = await createToken(page, org, 'decisions', { scopes: ['docket:read', 'docket:write'], description: 'e2e trust' })
  await page.goto(`/a/${org}/members`)
})
test.afterAll(() => page?.context().close())

test('an agent’s evidence that cites no source is its person’s, and a supersede under the bar waits as a proposal', async ({ request }) => {
  const proposed = await decide(request, 'decision.fraud-in-house', 'decision.fraud-on-radar')
  expect(proposed.result?.isError).toBeFalsy()
  // Alice has no role in the directory yet: a person said so, 0.5 of the 0.8 a decision needs.
  expect(proposed.result?.structuredContent).toMatchObject({
    tool: 'docket_supersede',
    ok: true,
    status: 'pending',
    proposal: { status: 'pending', score: 0.5, threshold: 0.8, carry: expect.arrayContaining([expect.objectContaining({ policy: 'A lead said so', source: 'person' })]) },
  })
  expect(proposed.result?.content?.[0]?.text).toContain('Until then decision.fraud-in-house is current.')

  const got = await call(request, 'docket_get', { id: 'decision.fraud-in-house' })
  expect(got.result?.structuredContent).toMatchObject({ pendingReplacement: { by: 'decision.fraud-on-radar', score: 0.5, threshold: 0.8 } })
  const evidence = (got.result?.structuredContent as { resource: { evidence: Record<string, unknown>[] } }).resource.evidence
  expect(evidence[0]).toMatchObject({ source: 'person', principal: 'alice' })

  const listed = await api('GET', `/api/o/${org}/w/decisions/proposals?status=pending`)
  expect(listed.status).toBe(200)
  expect(listed.body?.proposals).toEqual([expect.objectContaining({ resource: 'decision.fraud-in-house', by: 'decision.fraud-on-radar', status: 'pending', score: 0.5 })])
})

test('making the writer a lead in the directory scores them again, and carries the proposal into fact', async ({ request }) => {
  const set = await api('PUT', `/api/o/${org}/people/alice`, { attributes: { role: 'lead' } })
  expect(set).toEqual({ status: 200, body: expect.objectContaining({ login: 'alice', attributes: { role: 'lead' } }) })
  const people = await api('GET', `/api/o/${org}/people`)
  expect(people.body?.people).toEqual([expect.objectContaining({ login: 'alice', role: 'Owner', attributes: { role: 'lead' } })])

  const accepted = await api('GET', `/api/o/${org}/w/decisions/proposals?status=accepted`)
  expect(accepted.body?.proposals).toEqual([expect.objectContaining({ resource: 'decision.fraud-in-house', status: 'accepted', decidedBy: 'score' })])
  const got = await call(request, 'docket_get', { id: 'decision.fraud-in-house' })
  expect(got.result?.content?.[0]?.text).toContain('Out of date:')
  await api('PUT', `/api/o/${org}/people/alice`, { attributes: {} })
})

test('a member rejects a pending proposal, and an owner accepts one regardless, each with why', async ({ request }) => {
  const first = await decide(request, 'decision.deploy-fridays', 'decision.no-deploy-fridays')
  const firstId = (first.result?.structuredContent as { proposal: { id: string } }).proposal.id
  expect((await api('POST', `/api/o/${org}/w/decisions/proposals/${firstId}`, { decision: 'reject' })).status).toBe(400)
  const rejected = await api('POST', `/api/o/${org}/w/decisions/proposals/${firstId.slice(0, 8)}`, { decision: 'reject', reason: 'We still deploy on Fridays.' })
  expect(rejected).toEqual({ status: 200, body: expect.objectContaining({ ok: true, proposal: expect.objectContaining({ status: 'rejected' }) }) })

  const second = await decide(request, 'decision.monorepo', 'decision.polyrepo')
  const secondId = (second.result?.structuredContent as { proposal: { id: string } }).proposal.id
  const accepted = await api('POST', `/api/o/${org}/w/decisions/proposals/${secondId}`, { decision: 'accept', reason: 'The CTO signed it off.' })
  expect(accepted.body).toMatchObject({ ok: true, proposal: { status: 'accepted', score: 0.5 } })
  const one = await api('GET', `/api/o/${org}/w/decisions/proposals/${secondId}`)
  expect(one.body).toMatchObject({ status: 'accepted', decidedBy: 'override:alice', override: 'The CTO signed it off.' })
  expect((await api('POST', `/api/o/${org}/w/decisions/proposals/${secondId}`, { decision: 'confirm' })).body).toMatchObject({ ok: true })
  expect((await api('GET', `/api/o/${org}/w/decisions/proposals/nosuchid1`)).status).toBe(404)
})

test('a registered document is attested; an agent’s claim about it is not', async ({ request }) => {
  const claimed = await call(request, 'docket_remember', {
    id: 'decision.vendor-review',
    type: 'decision',
    title: 'Vendor review',
    evidence: [{ source: 'document', locator: { url: 'notion://vendor-review' }, attributes: { status: 'verified' } }],
  })
  expect(claimed.result?.isError).toBeFalsy()
  const confidence = async () =>
    ((await call(request, 'docket_get', { id: 'decision.vendor-review' })).result?.structuredContent as { resource: { confidence: number } }).resource.confidence
  expect(await confidence()).toBe(0.4)

  const registered = await api('PUT', `/api/o/${org}/sources`, { source: 'document', instance: 'notion://vendor-review', attributes: { status: 'verified' } })
  expect(registered).toEqual({ status: 200, body: expect.objectContaining({ source: 'document', instance: 'notion://vendor-review', attributes: { status: 'verified' } }) })
  expect(await confidence()).toBe(0.9)
  expect((await api('GET', `/api/o/${org}/sources?source=document`)).body?.sources).toHaveLength(1)
  expect((await api('PUT', `/api/o/${org}/sources`, { source: 'document', instance: 'x', attributes: { 'not a name': 1 } })).status).toBe(400)

  expect((await api('DELETE', `/api/o/${org}/sources?source=document&instance=${encodeURIComponent('notion://vendor-review')}`)).status).toBe(204)
  expect(await confidence()).toBe(0.4)
})

test('a system account is made in Settings › System accounts, and no person acts for it', async () => {
  await page.goto(`/a/${org}/settings/system-accounts`)
  await page.getByLabel('Name', { exact: true }).fill('ci-bot')
  await page.getByRole('button', { name: 'Create system account' }).click()
  await expect(page.getByText('Created ci-bot. Issue it a token below.')).toBeVisible()
  await page.goto(`/a/${org}/settings/system-accounts`)
  await expect(page.locator('[data-service="ci-bot"]')).toContainText('Reader on')
  const people = await api('GET', `/api/o/${org}/people`)
  expect(people.body?.people).toEqual([expect.objectContaining({ login: 'alice' })])
  expect(people.body?.people?.[0]).not.toHaveProperty('agents')
})
