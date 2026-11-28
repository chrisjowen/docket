// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

/** docket's worked example, `examples/acme-platform`: 21 resources and 37 links. */
const ACME = join(import.meta.dirname, '..', 'fixtures', 'acme-platform')
const ontology = readFileSync(join(ACME, '.docket', 'entities.yaml'), 'utf8')
const documents = readdirSync(join(ACME, '.docket'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => {
    const path = join(entry.parentPath, entry.name)
    return { name: relative(ACME, path).replace(/\//g, '_'), mimeType: 'text/markdown', buffer: readFileSync(path) }
  })
/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

/**
 * M4's acceptance: the acme-platform example, loaded through an import, shows
 * the same graph as `docket open` on it (the API is compared field by field
 * in packages/canonical-store/src/graph.int.test.ts), and the index catches up.
 */
test('the graph browser shows an imported workspace, and its index catches up', async ({ page }) => {
  // The index wait below needs more than the default 30s budget.
  test.setTimeout(90_000)
  await signIn(page, 'alice')
  const slug = await createOrg(page, `Graph ${unique()}`)
  await page.goto(`/a/${slug}/dockets/new`)
  await page.getByLabel('Name').fill('Acme')
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: Buffer.from(ontology) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${slug}/d/acme/ontology$`))
  await page.goto(`/a/${slug}/d/acme/documents`)
  await page.locator('input[name="files"]').setInputFiles(documents)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 21 documents.')).toBeVisible()

  // The JSON API serves docket-ui's UiGraph shape.
  const api = await page.request.get(`/api/o/${slug}/w/acme/graph`)
  expect(api.status()).toBe(200)
  const graph = (await api.json()) as { entities: { id: string }[]; edges: unknown[]; types: unknown[]; index: { synced: boolean } }
  expect(graph.entities).toHaveLength(21)
  expect(graph.edges).toHaveLength(37)
  expect(graph.entities.map((entity) => entity.id)).toContain('service.orders')

  await page.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Record' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${slug}/d/acme/graph$`))
  await expect(page.getByText('21 records and 37 relations')).toBeVisible()
  await expect(page.getByTestId('board').locator('g[role="button"]')).toHaveCount(21)

  // Picking a case card opens its case file in the drawer, frames it with its neighbours, and puts it in the address.
  await page.getByTestId('board').locator('g[role="button"][data-id="service.orders"]').click()
  const inspector = page.getByTestId('inspector')
  await expect(inspector.getByRole('heading', { name: 'Orders' })).toBeVisible()
  await expect(page).toHaveURL(/[?&]focus=service\.orders/)
  await expect(page.getByTestId('board').locator('g.sel')).toHaveAttribute('data-id', 'service.orders')
  await expect(inspector).toContainText('service.orders')
  await expect(inspector.getByTestId('notes')).toContainText('Owns the order lifecycle from cart submission to fulfilment handoff.')
  await expect(inspector.getByTestId('linked-records')).toContainText('depends_on')
  await expect(inspector.getByRole('button', { name: 'Close the case file' })).toBeFocused()
  // Escape closes it and leaves the whole board in view.
  await page.keyboard.press('Escape')
  await expect(inspector).toBeHidden()
  await expect(page).not.toHaveURL(/focus=/)

  // On the facts view a record's case file opens in the same drawer, with the findings about it; one opens its note.
  await page.goto(`/a/${slug}/d/acme/graph?view=facts&focus=service.orders`)
  await expect(inspector.getByRole('heading', { name: 'Orders' })).toBeVisible()
  const findings = inspector.getByTestId('case-findings')
  await expect(findings.getByRole('button').first()).toContainText('Orders')
  // Orders' Stripe dependency is filed with two exhibits.
  await findings.getByRole('button', { name: /Orders depends on Stripe/ }).click()
  await expect(page).toHaveURL(/view=facts&focus=service\.orders&open=F-\d{3}$/)
  const opened = new URL(page.url()).searchParams.get('open') ?? ''
  await expect(page.locator(`#note-${opened}`).getByRole('button', { name: /^Hide \d+ exhibits?$/ })).toHaveAttribute('aria-expanded', 'true')
  // Orders has more findings than the case file lists: the rest open together on the Facts view.
  await findings.getByRole('button', { name: /^\d+ more in Facts$/ }).click()
  await expect(page).toHaveURL(/view=facts&focus=service\.orders&about=service\.orders$/)
  const facts = page.getByTestId('fact')
  await expect(facts.filter({ has: page.getByRole('heading', { name: 'Orders depends on Stripe', exact: true }) })).toHaveCount(1)
  await expect(facts.filter({ has: page.getByRole('heading', { name: 'Checkout depends on Orders', exact: true }) })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(inspector).toBeHidden()
  await expect(page).not.toHaveURL(/focus=/)
  await page.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Record' }).click()

  // Switching a record type off takes its cards off the board.
  const services = page.getByRole('group', { name: 'Record types' }).getByRole('button', { name: 'service' })
  await services.click()
  await expect(services).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('board').locator('g[role="button"]')).not.toHaveCount(21)
  await services.click()
  await expect(page.getByTestId('board').locator('g[role="button"]')).toHaveCount(21)

  if (WORKER) {
    await expect(page.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
  } else {
    await expect(page.getByTestId('index-status')).toContainText('Indexing')
  }

  // A query draws only what the docket's search finds and the records one link away, and goes in the address.
  const cards = page.getByTestId('board').locator('g[role="button"]')
  const query = page.getByTestId('graph-query')
  await query.getByRole('searchbox', { name: 'Query text' }).fill('stripe')
  await query.getByRole('searchbox', { name: 'Query text' }).press('Enter')
  await expect(page).toHaveURL(/[?&]q=stripe/)
  await expect(page.getByTestId('board-note')).toContainText(/\d+ match(es)? and \d+ linked records?/)
  await expect(cards.and(page.locator('[data-id="system.stripe"]'))).toHaveCount(1)
  expect(await cards.count()).toBeLessThan(21)
  // Clearing it brings the whole board back.
  await page.getByTestId('graph-query-clear').click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(cards).toHaveCount(21)
  // A type alone filters the records without a search.
  await query.getByRole('combobox', { name: 'Query type' }).selectOption('team')
  await expect(page).toHaveURL(/[?&]type=team/)
  await expect(page.getByTestId('board-note')).toContainText(/\d+ match(es)? and \d+ linked records?/)
  expect(await cards.count()).toBeLessThan(21)
  await page.getByTestId('graph-query-clear').click()
  await expect(cards).toHaveCount(21)

  // Full screen fills the window and goes in the address; Escape leaves it.
  await page.getByTestId('full-screen').click()
  await expect(page).toHaveURL(/[?&]full=1/)
  await expect(page.getByTestId('network-stage')).toHaveCSS('position', 'fixed')
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/full=1/)
  await expect(page.getByTestId('network-stage')).not.toHaveCSS('position', 'fixed')
})

test("a member of another org gets 404 for this org's graph", async ({ browser }) => {
  const carol = await (await browser.newContext()).newPage()
  await signIn(carol, 'carol')
  const response = await carol.request.get('/api/o/nosuch/w/acme/graph')
  expect(response.status()).toBe(404)
})
