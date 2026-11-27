// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'

import { createOrg, createToken, mcp, signIn, unique } from './helpers'

/**
 * The schema editor (the trust design's P5): types and their relations in one
 * place, sources with the attributes they have and who may set them, and
 * policies with a live preview of what evidence would score and what a draft
 * re-scores.
 */

const ONTOLOGY = `version: 1
resourceTypes:
  service:
    description: A service.
  vendor:
    description: A company we buy from.
  team:
    description: A team.
relationships:
  depends_on:
    from: [service]
    to: [service, vendor]
  owned_by:
    from: [service]
    to: [team]
sources:
  person:
    kind: identity
    attributes:
      role: { type: string, enum: [lead, engineer, intern], setBy: directory }
  document:
    kind: content
    identifiedBy: [url]
    attributes:
      status: { type: string, enum: [verified, unverified], setBy: registry }
    locator:
      url: { required: true }
trust:
  policies:
    - name: A person said so
      when: { source: person }
      score: 0.6
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

const LEGACY = `version: 1
resourceTypes:
  service:
    description: A service.
    confidence: { code: 0.7 }
relationships: {}
evidence:
  unevidenced: 0.5
  sources:
    code:
      description: Source code.
      confidence: 0.6
      requires: [path]
`

// One org and workspace, built on test by test.
test.describe.configure({ mode: 'serial' })

let page: Page
let org = ''
const editor = () => `/o/${org}/w/vendors/ontology`

async function workspace(name: string, yaml: string) {
  await page.goto(`/o/${org}/workspaces/new`)
  await page.getByLabel('Name').fill(name)
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(/\/ontology$/)
}

async function draft(tab: string) {
  await page.goto(editor())
  await page.getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/draft=/)
  await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
}

test.beforeAll(async ({ browser, request }) => {
  page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Schema ${unique()}`)
  await workspace('Vendors', ONTOLOGY)
  const token = await createToken(page, org, 'vendors', { scopes: ['docket:read', 'docket:write'], description: 'e2e schema' })
  const remember = (args: Record<string, unknown>) => mcp(request, `/mcp/${org}/vendors`, token, 'tools/call', { name: 'docket_remember', arguments: args })
  await remember({ id: 'vendor.adyen', type: 'vendor', title: 'Adyen', evidence: [{ source: 'document', locator: { url: 'notion://vendor-review' } }] })
  await remember({ id: 'service.checkout', type: 'service', title: 'Checkout', evidence: [{ note: 'We run it.' }] })
})
test.afterAll(() => page?.context().close())

test('types and their relations are edited together: a target chip, a "+ type" menu, and what points back', async () => {
  await draft('Types')
  await page.getByRole('navigation', { name: 'Types' }).getByRole('button', { name: /^service/ }).click()
  const row = page.locator('[data-relation="depends_on"]')
  await expect(row).toContainText('vendor')
  await row.getByRole('button', { name: '+ type' }).click()
  await page.getByRole('menu', { name: 'Types depends_on can point to' }).getByRole('menuitem', { name: /team/ }).click()
  await expect(row).toContainText('team')
  await expect(page.getByRole('region', { name: 'Draft' })).toContainText('depends_on can now point to team')
  await expect(page.getByTestId('classification')).toHaveText('safe')

  // From the vendor's side: depends_on points to it, from services.
  await page.getByRole('navigation', { name: 'Types' }).getByRole('button', { name: /^vendor/ }).click()
  await expect(page.getByRole('list', { name: 'What points to a vendor' })).toContainText('depends_on')
  await expect(page.getByRole('img', { name: 'vendor and the types it connects to' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit on service' }).click()
  await expect(page.getByLabel('Type name', { exact: true })).toHaveValue('service')
})

test('sources say what attributes they have and who may set them, and the directory and registry are edited live', async () => {
  await page.getByRole('tab', { name: /^Sources/ }).click()
  await page.getByRole('navigation', { name: 'Source types' }).getByRole('button', { name: /person/ }).click()
  await expect(page.getByLabel('Who may set role')).toHaveValue('directory')
  await expect(page.getByText('Agents are not a source.')).toBeVisible()
  // Alice is made a lead, at once: the directory is not part of the draft.
  const people = page.getByRole('table', { name: 'People' })
  await people.getByLabel('role of alice').selectOption('lead')
  await expect(page.getByRole('status').filter({ hasText: 'role is now lead' })).toBeVisible()
  await expect.poll(async () => (await (await page.request.get(`/api/o/${org}/people`)).json()).people[0].attributes).toEqual({ role: 'lead' })

  await page.getByRole('navigation', { name: 'Source types' }).getByRole('button', { name: /document/ }).click()
  await page.getByLabel('Instance to register').fill('notion://vendor-review')
  await page.getByLabel('status of the new instance').selectOption('verified')
  await page.getByRole('button', { name: 'Register' }).click()
  await expect(page.getByRole('table', { name: 'Registered document sources' })).toContainText('notion://vendor-review')
})

test('policies: an edit shows what it re-scores, and the preview prices evidence with the engine', async () => {
  await page.getByRole('tab', { name: /^Policies/ }).click()
  // The preview: an unregistered document claiming to be verified is not believed.
  const panel = page.getByRole('complementary', { name: 'What would this evidence score?' })
  await panel.getByLabel('Found in').selectOption('document')
  await panel.getByLabel('Claim status').selectOption('verified')
  await expect(panel.getByTestId('verdict-score')).toHaveText('0.40')
  await expect(panel.getByTestId('verdict')).toContainText('Ignored the writer')
  // The registered one is.
  await panel.getByLabel('Which one').selectOption('notion://vendor-review')
  await expect(panel.getByTestId('verdict-score')).toHaveText('0.90')
  await expect(page.locator('tr[data-policy="A verified document"]')).toHaveClass(/hit/)

  // Lowering "A verified document" re-scores Adyen, whose evidence is that document.
  await page.getByLabel('Score of A verified document').fill('0.45')
  await page.getByLabel('Score of A verified document').press('Tab')
  await expect(page.getByTestId('classification')).toHaveText('rescore')
  const impact = page.getByRole('region', { name: 'Re-score against the record' })
  await expect(impact).toContainText('vendor.adyen')
  await expect(impact).toContainText('now Unverified')
  await expect(panel.getByTestId('verdict-score')).toHaveText('0.45')

  // The editor says the selected policy in words.
  await page.locator('tr[data-policy="A lead said so"]').click()
  await expect(page.getByTestId('policy-sentence')).toHaveText('When the source is a person with role = lead, about anything: score 0.85')

  // A rescore publishes without "publish anyway".
  await expect(page.getByRole('button', { name: 'Publish v2' })).toBeEnabled()
  await page.getByRole('button', { name: 'Publish v2' }).click()
  await expect(page.getByText('Published v2.')).toBeVisible()
})

test('a schema in the old evidence form converts to sources and policies, every score unchanged', async () => {
  await workspace('Legacy', LEGACY)
  await page.goto(`/o/${org}/w/legacy/ontology`)
  await page.getByRole('button', { name: 'Start a draft' }).click()
  await page.getByRole('tab', { name: /^Policies/ }).click()
  await page.getByRole('button', { name: 'Convert to sources & policies' }).click()
  await expect(page.locator('tr[data-policy="code evidence"]')).toBeVisible()
  await expect(page.locator('tr[data-policy="code evidence of service"]')).toBeVisible()
  await expect(page.getByText('Moved here from v1.')).toBeVisible()
  await expect(page.getByTestId('classification')).toHaveText('safe')
})
