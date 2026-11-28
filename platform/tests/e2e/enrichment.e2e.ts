// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'workspace', '.docket')
/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

/** Two more services: one whose description names a database it is not linked to, and a second "Payments" that disagrees with the first. */
const EXTRA = {
  'checkout.md':
    '---\nid: service.checkout\ntype: service\ntitle: Checkout\nattributes:\n  tier: critical\nlinks:\n  - rel: owned_by\n    target: team.commerce\n---\nTakes the basket and writes every charge to the Ledger database.\n',
  'payments-v2.md': '---\nid: service.payments-v2\ntype: service\ntitle: Payments\nattributes:\n  tier: standard\n---\nThe new payments service.\n',
}

/** A workspace on the 12-document fixture and its ontology, with the two services above: 14 documents. */
async function fixtureWorkspace(page: Page, org: string): Promise<string> {
  const documents = [
    ...readdirSync(FIXTURE, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => ({ name: entry.name, mimeType: 'text/markdown', buffer: readFileSync(join(entry.parentPath, entry.name)) })),
    ...Object.entries(EXTRA).map(([name, raw]) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(raw) })),
  ]
  await page.goto(`/a/${org}/dockets/new`)
  await page.getByLabel('Name').fill('Platform')
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: readFileSync(join(FIXTURE, 'entities.yaml')) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${org}/d/platform/ontology$`))
  await page.goto(`/a/${org}/d/platform/documents`)
  await page.locator('input[name="files"]').setInputFiles(documents)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 14 documents.')).toBeVisible()
  return `/a/${org}/d/platform`
}

test('background enrichment is off until an admin turns it on, which adds what it writes with to the ontology', async ({ page }) => {
  await signIn(page, 'alice')
  const org = await createOrg(page, `Enrich ${unique()}`)
  const ws = await fixtureWorkspace(page, org)

  await page.goto(`${ws}/settings`)
  const section = page.getByTestId('enrichment')
  await expect(section.getByTestId('enrichment-status')).toHaveText('Off')
  await expect(section.getByRole('button', { name: 'Run now' })).toHaveCount(0)

  await section.getByLabel('Run background enrichment for this docket').check()
  await section.getByLabel('Schedule').selectOption('weekly')
  await section.getByLabel(/Monthly AI limit/).fill('1.5')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('status')).toContainText(
    'On, weekly, up to $1.50 of AI a month. Published ontology v2 with the inferred evidence source, the duplicate_of relationship, the contradicts relationship.',
  )
  await expect(page.getByTestId('head')).toHaveText('Schema v2')
  await expect(section.getByTestId('enrichment-status')).toContainText('On, weekly; next run')

  // Saving again publishes nothing more.
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('status')).toHaveText('Saved. On, weekly, up to $1.50 of AI a month.')
  await expect(page.getByTestId('head')).toHaveText('Schema v2')

  await section.getByLabel('Run background enrichment for this docket').uncheck()
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByTestId('enrichment-status')).toHaveText('Off')
})

test('a run writes inferred links with their reasoning and evidence, and its inferences retire together for good', async ({ page }) => {
  test.skip(!WORKER, 'needs the worker')
  test.setTimeout(120_000)
  await signIn(page, 'alice')
  const org = await createOrg(page, `Enrich ${unique()}`)
  const ws = await fixtureWorkspace(page, org)

  await page.goto(`${ws}/settings`)
  const section = page.getByTestId('enrichment')
  await section.getByLabel('Run background enrichment for this docket').check()
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('status')).toContainText('Published ontology v2')
  await section.getByRole('button', { name: 'Run now' }).click()
  await expect(section.getByRole('status')).toContainText('Asked for a run')

  // The page follows the run until it finishes. AI is off here, so the owner only a team names is left open.
  const run = section.getByTestId('enrichment-run').first()
  await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 60_000 })
  await expect(run.getByTestId('enrichment-summary')).toContainText('Wrote 8 (1 link, 5 owners, 1 duplicate, 1 contradiction) of 9 found.')
  await expect(run).toContainText('only what the rules decide alone was written')

  // The inference is an ordinary link of the graph, with inferred evidence citing where it was read.
  const graph = await (await page.request.get(`/api/${ws.slice(1)}/graph`)).json()
  const api = graph.entities.find((entity: { id: string }) => entity.id === 'api.orders')
  const owner = api.links.find((link: { rel: string }) => link.rel === 'owned_by')
  expect(owner.target).toBe('team.commerce')
  expect(owner.evidence[0]).toMatchObject({ source: 'inferred', observedBy: 'docket-cloud enrichment' })
  expect(owner.evidence[0].note).toMatch(/has no owner/)
  expect(api.paths).toEqual(['.docket/resources/api/orders.md', '.docket/~inferred/api.orders/owner--owned_by--team.commerce.md'])
  const v2 = graph.entities.find((entity: { id: string }) => entity.id === 'service.payments-v2')
  expect(v2.links.map((link: { rel: string; target: string }) => `${link.rel} ${link.target}`).sort()).toEqual(['contradicts service.payments', 'duplicate_of service.payments'])

  await page.goto(`${ws}/activity?channel=enrichment`)
  await expect(page.getByTestId('activity-event')).toHaveCount(8)
  await expect(page.getByTestId('activity-event').first()).toContainText('docket-cloud enrichment inferred something about')

  // Retire the run: every document it wrote goes, and the next run writes none of it back.
  await page.goto(`${ws}/settings`)
  await section.getByRole('button', { name: 'Retire the 8 it added' }).click()
  await expect(section.getByRole('status')).toHaveText('Retired 8 inferred documents.')
  await expect(section.getByTestId('enrichment-run').first()).toContainText('Retired by @alice')
  await section.getByRole('button', { name: 'Run now' }).click()
  await expect(section.getByTestId('enrichment-run')).toHaveCount(2, { timeout: 60_000 })
  await expect(section.getByTestId('enrichment-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 60_000 })
  await expect(section.getByTestId('enrichment-run').first().getByTestId('enrichment-summary')).toContainText('Wrote 0 of')
  const after = await (await page.request.get(`/api/${ws.slice(1)}/graph`)).json()
  expect(after.entities.find((entity: { id: string }) => entity.id === 'api.orders').links.some((link: { rel: string }) => link.rel === 'owned_by')).toBe(false)
})
