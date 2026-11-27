// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * The record and the graph explained by policies (the trust design's P6): one
 * band definition across the network's colours, legend and query tokens; a
 * hover card and a record's "Why" that say which rules priced each source;
 * and the Proposals queue, where a pending replacement is confirmed - scored
 * like any other evidence - or turned down.
 */

const ONTOLOGY = `version: 1
resourceTypes:
  service:
    description: A service.
  decision:
    description: A decision the team made.
relationships:
  depends_on:
    from: [service]
    to: [service]
sources:
  person:
    kind: identity
    attributes:
      role: { type: string, setBy: directory }
  document:
    kind: content
    identifiedBy: [url]
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
`

// One org and workspace, built on test by test.
test.describe.configure({ mode: 'serial' })

let page: Page
let org = ''
let token = ''
const base = () => `/o/${org}/w/platform`

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await mcp(request, `/mcp/${org}/platform`, token, 'tools/call', { name, arguments: args })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text: string }[] } }
  expect(body.result?.isError, JSON.stringify(body.result?.content)).toBeFalsy()
  return body
}

const document = (url: string) => ({ source: 'document', locator: { url } })

test.beforeAll(async ({ browser, request }) => {
  page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Record ${unique()}`)
  await page.goto(`/o/${org}/workspaces/new`)
  await page.getByLabel('Name').fill('Platform')
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: Buffer.from(ONTOLOGY) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(/\/ontology$/)
  token = await createToken(page, org, 'platform', { scopes: ['docket:read', 'docket:write'], description: 'e2e record' })
  // Alice is a lead: what she says first-hand scores 0.85.
  const lead = await page.request.put(`/api/o/${org}/people/alice`, { data: { attributes: { role: 'lead' } }, headers: { 'x-csrf-token': await csrfOf(page) } })
  expect(lead.status()).toBe(200)

  await call(request, 'docket_remember', { id: 'service.legacy', type: 'service', title: 'Legacy billing', evidence: [document('notion://billing')] })
  await call(request, 'docket_remember', {
    id: 'service.checkout',
    type: 'service',
    title: 'Checkout',
    evidence: [{ note: 'I own this.' }, { note: 'It calls billing.' }],
    links: [{ rel: 'depends_on', target: 'service.legacy', evidence: [{ note: 'Checkout calls billing.' }] }],
  })
  for (const [id, title] of [
    ['decision.in-house', 'Fraud checks in house'],
    ['decision.on-radar', 'Fraud checks on Radar'],
    ['decision.monorepo', 'One repository'],
    ['decision.polyrepo', 'A repository per service'],
  ]) {
    await call(request, 'docket_remember', { id, type: 'decision', title, evidence: [{ note: 'Agreed at the review.' }] })
  }
  // Only a document so far: 0.40 of the 0.80 a decision needs.
  for (const [id, by] of [
    ['decision.in-house', 'decision.on-radar'],
    ['decision.monorepo', 'decision.polyrepo'],
  ]) {
    await call(request, 'docket_supersede', { id, by, reason: 'The team changed its mind.', evidence: [document(`notion://${by}`)] })
  }
})
test.afterAll(() => page?.context().close())

test('the network colours by confidence band, counts each in its legend, and filters by query tokens', async () => {
  await page.goto(`${base()}/graph`)
  await page.getByRole('group', { name: 'Colour by' }).getByRole('button', { name: 'By confidence' }).click()
  await expect(page).toHaveURL(/colour=confidence/)

  const legend = page.getByTestId('legend')
  await expect(legend.locator('[data-band="established"]')).toContainText('≥ 0.80')
  await expect(legend.locator('[data-band="established"] b')).toHaveText('5')
  await expect(legend.locator('[data-band="unverified"] b')).toHaveText('1')
  await expect(legend.locator('[data-band="pending"] b')).toHaveText('2')

  const board = page.getByTestId('board')
  await expect(board.locator('g[data-id="service.legacy"]')).toHaveAttribute('data-band', 'unverified')
  await expect(board.locator('g[data-id="service.checkout"]')).toHaveAttribute('data-band', 'established')
  await expect(board.locator('g[data-id="decision.in-house"]')).toHaveAttribute('aria-label', /pending proposal/)

  // A token filters here; the record it matches and the one linked to it stay drawn.
  const query = page.getByTestId('graph-query')
  await query.getByRole('searchbox', { name: 'Query text' }).fill('band:unverified')
  await query.getByRole('searchbox', { name: 'Query text' }).press('Enter')
  await expect(page.getByTestId('token-matches')).toHaveText('1 of 6 records match band:unverified, with 1 linked record')
  await page.getByTestId('graph-query-clear').click()
  await expect(page.getByTestId('token-matches')).toBeHidden()

  // The quick chips and the legend run tokens too.
  await page.getByRole('group', { name: 'Quick queries' }).getByRole('button', { name: 'Pending proposals' }).click()
  await expect(page.getByTestId('token-matches')).toContainText('2 of 6 records match is:pending')
  await legend.locator('[data-band="pending"]').click()
  await expect(page.getByTestId('token-matches')).toBeHidden()

  // The hover card names the rules behind each source.
  await board.locator('g[data-id="service.checkout"]').focus()
  const tip = page.getByTestId('card-tip')
  await expect(tip).toContainText('A lead said so 0.85')
  await expect(tip).toContainText('= 0.85')
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
})

test('a record’s case file explains its confidence, and each rule opens the schema editor on its policy', async () => {
  await page.goto(`${base()}/graph?focus=service.checkout`)
  const inspector = page.getByTestId('inspector')
  await expect(inspector.getByTestId('confidence')).toHaveText('0.85')
  await expect(inspector.getByTestId('band')).toHaveText('Established')
  const why = inspector.getByTestId('evidence')
  await expect(why.getByRole('heading', { name: /Why 0\.85/ })).toBeVisible()
  // Two observations from alice: one source, counted once at its strongest.
  await expect(why.locator('[data-counts="true"]')).toHaveCount(1)
  await expect(why.locator('[data-counts="false"]')).toContainText('a stronger observation counts instead')
  await expect(why.getByTestId('why-formula')).toHaveText('1 − (1 − 0.85) = 0.85')

  await why.getByRole('link', { name: /A lead said so/ }).first().click()
  await expect(page).toHaveURL(/\/ontology\?tab=policies/)
  await expect(page.locator('tr[data-policy="A lead said so"]')).toHaveClass(/sel/)

  // A record a proposal would replace says so, and links to it.
  await page.goto(`${base()}/graph?focus=decision.in-house`)
  await expect(inspector.getByTestId('pending')).toHaveText('Pending')
  await expect(inspector.getByTestId('pending-notice')).toContainText('0.40 of the 0.80 it needs')
  await inspector.getByTestId('pending-notice').getByRole('link', { name: 'Review the proposal' }).click()
  await expect(page).toHaveURL(new RegExp(`${base()}/proposals/[0-9a-f-]+$`))
})

test('the Proposals queue shows how far a replacement has got, and a lead’s confirmation carries it', async () => {
  await page.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Proposals' }).click()
  await expect(page).toHaveURL(`${base()}/proposals`)
  await expect(page.getByRole('link', { name: /Pending 2/ })).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('proposal-queue').getByRole('link', { name: /Fraud checks on Radar/ }).click()
  await expect(page).toHaveURL(new RegExp(`${base()}/proposals/[0-9a-f-]+`))

  const proposal = page.getByTestId('proposal')
  await expect(proposal.getByRole('meter')).toHaveAttribute('aria-label', 'Score 0.40 of the 0.80 it needs')
  await expect(proposal.getByTestId('carry')).toContainText('A lead said so')
  await expect(proposal.getByTestId('ask-now')).toContainText('Fraud checks in house (decision.in-house), the current record.')
  await expect(proposal.getByTestId('agent-answer')).toContainText('"tool": "docket_supersede"')
  // Alice's own word would be scored like any other: 1 − (1 − 0.40)(1 − 0.85) = 0.91.
  await expect(proposal.getByTestId('confirm-worth')).toHaveText('Your confirmation would make it 0.91: enough to carry it.')

  await proposal.getByRole('button', { name: 'Confirm as alice' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Confirmed, and that carried it: 0.91 clears 0.80.' })).toBeVisible()
  await expect(proposal).toHaveAttribute('data-status', 'accepted')
  await expect(proposal.getByTestId('ask-now')).toContainText('It replaced “Fraud checks in house”.')
  await expect(page.getByRole('link', { name: /Accepted 1/ })).toBeVisible()
})

test('a member turns a proposal down with a reason, and the older record stays current', async () => {
  await page.goto(`${base()}/proposals`)
  await page.getByTestId('proposal-queue').getByRole('link', { name: /A repository per service/ }).click()
  await expect(page).toHaveURL(new RegExp(`${base()}/proposals/[0-9a-f-]+`))
  const proposal = page.getByTestId('proposal')
  await proposal.getByRole('button', { name: 'Reject' }).click()
  await proposal.getByLabel('Why reject it').fill('We are keeping the monorepo.')
  await proposal.getByRole('button', { name: 'Reject it' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Rejected. The older record stays current' })).toBeVisible()
  await expect(proposal).toHaveAttribute('data-status', 'rejected')
  await expect(proposal.getByTestId('ask-now')).toContainText('A proposal to replace it was rejected')

  await page.goto(`${base()}/graph?focus=decision.monorepo`)
  await expect(page.getByTestId('inspector').getByTestId('pending')).toBeHidden()
  await expect(page.getByTestId('inspector').getByTestId('standing')).not.toHaveText('Overruled')
})
