// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

/**
 * The graph tab's other views of the same knowledge: Facts (every record and
 * relation written up as a note citing its exhibits, with its weight and
 * standing, filtered to the weak or single-source ones), Timeline (dated evidence, supersessions and the
 * activity log) and Evidence (each document's trail). Each view, filter and
 * selection lives in the address, so a link opens the same view.
 */

let org = ''
let writer = ''

async function addEvidence(request: APIRequestContext, args: Record<string, unknown>) {
  const response = await mcp(request, `/mcp/${org}/acme`, writer, 'tools/call', { name: 'docket_add_evidence', arguments: args })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text: string }[] } }
  expect(body.result?.isError, body.result?.content?.[0]?.text).toBeFalsy()
}

async function alice(browser: import('@playwright/test').Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  return page
}

test.beforeAll(async ({ browser }) => {
  const page = await alice(browser)
  org = await createOrg(page, `Views ${unique()}`)
  await acmeWorkspace(page, org)
  writer = await createToken(page, org, 'acme', { scopes: ['docket:read', 'docket:write'], description: 'e2e views' })
  const request = page.request
  // Orders rests on two kinds of source; Platform Engineering and one of Checkout's links on one.
  await addEvidence(request, { id: 'service.orders', evidence: [{ source: 'code', path: 'orders/main.go', observedAt: '2026-10-01' }] })
  await addEvidence(request, { id: 'service.orders', evidence: [{ source: 'human', note: 'confirmed in the platform review' }] })
  await addEvidence(request, { id: 'team.platform-engineering', evidence: [{ source: 'code', path: 'CODEOWNERS' }] })
  await addEvidence(request, { id: 'service.checkout', link: { rel: 'depends_on', target: 'service.orders' }, evidence: [{ source: 'code', path: 'checkout/orders-client.ts' }] })
  await page.context().close()
})

test('facts: every record and relation as a note, filtered to the strong, needing corroboration and single-source ones, and the filter survives a reload', async ({ browser }) => {
  const page = await alice(browser)
  await page.goto(`/o/${org}/w/acme/graph`)
  await page.getByTestId('view-facts').click()
  await expect(page).toHaveURL(/\?view=facts$/)
  // 21 records and 37 relations.
  await expect(page.getByTestId('facts-count')).toContainText('58 of 58 facts')

  await page.getByTestId('flag-single').click()
  await expect(page).toHaveURL(/view=facts&single=1/)
  const facts = page.getByTestId('fact')
  await expect(facts.filter({ hasText: 'Platform Engineering' }).filter({ hasText: 'team.platform-engineering' })).toHaveCount(1)
  await expect(facts.filter({ has: page.getByRole('heading', { name: 'Checkout depends on Orders', exact: true }) })).toHaveCount(1)
  // Orders has two kinds of source behind it: not single-source.
  await expect(facts.filter({ hasText: 'service.orders' })).toHaveCount(0)

  // The address carries the filter: a reload, or the link sent to someone, opens the same view.
  await page.reload()
  await expect(page.getByTestId('flag-single')).toHaveAttribute('aria-pressed', 'true')
  await expect(facts.filter({ hasText: 'team.platform-engineering' })).toHaveCount(1)
  await page.getByTestId('flag-single').click()
  await expect(page).toHaveURL(/\?view=facts$/)

  // Needs corroboration: everything that stands on the default alone, which an unevidenced exhibit does.
  await page.getByTestId('flag-weak').click()
  await expect(page).toHaveURL(/view=facts&flag=weak/)
  await expect(page.getByTestId('flag-weak')).toHaveText(/^Needs corroboration \d+$/)
  await expect(facts.filter({ hasText: 'decision.orders-on-dynamodb' })).toHaveCount(1)
  await expect(facts.filter({ hasText: 'service.orders' })).toHaveCount(0)

  // Strong: none of these rests on the default alone or on under 85% weight from evidence.
  await page.getByTestId('flag-strong').click()
  await expect(page).toHaveURL(/view=facts&flag=strong/)
  await expect(facts.filter({ hasText: 'decision.orders-on-dynamodb' })).toHaveCount(0)

  // A note's case file opens in the drawer, and its selection is in the address; the network shows the same case file.
  await page.getByTestId('flag-all').click()
  await page.getByRole('searchbox').fill('service.orders')
  await expect(page).toHaveURL(/q=service\.orders/)
  await facts.filter({ hasText: 'service.orders' }).first().getByRole('button', { name: 'Case file' }).click()
  await expect(page).toHaveURL(/focus=service\.orders/)
  await expect(page.getByTestId('inspector').getByRole('heading', { name: 'Orders' })).toBeVisible()
  await expect(page.getByTestId('inspector').getByTestId('case-exhibits')).toContainText('orders/main.go')
  await page.getByRole('button', { name: 'Show in the network' }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${org}/w/acme/graph\\?focus=service\\.orders$`))
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('inspector').getByRole('heading', { name: 'Orders' })).toBeVisible()

  // A document's "Show in graph" names the record in the fragment; the network opens its case file.
  await page.goto(`/o/${org}/w/acme/graph#service.checkout`)
  await expect(page).toHaveURL(new RegExp(`/graph\\?focus=service\\.checkout$`))
  await expect(page.getByTestId('inspector').getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await page.context().close()
})

test('facts: a note cites its exhibits inline, opens to quote them, and can be linked to', async ({ browser }) => {
  const page = await alice(browser)
  await page.goto(`/o/${org}/w/acme/graph?view=facts&kind=exhibit`)
  const orders = page.getByTestId('fact').filter({ has: page.getByRole('heading', { name: 'Orders', exact: true }) })
  // The record's own prose, then what its exhibits say, each cited by its number.
  await expect(orders).toContainText('Owns the order lifecycle')
  await expect(orders).toContainText('confirmed in the platform review')
  await expect(orders.locator('.prose button.ex').first()).toHaveText(/^Ex\. [A-Z]-\d+$/)

  // "Read N exhibits" quotes them in place, and the address names the open note.
  const read = orders.getByRole('button', { name: /^Read \d+ exhibits?$/ })
  await read.click()
  await expect(orders.getByRole('button', { name: /^Hide \d+ exhibits?$/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(orders.locator('.quoted')).toContainText('orders/main.go')
  await expect(page).toHaveURL(/open=F-\d{3}/)
  const no = new URL(page.url()).searchParams.get('open') ?? ''

  // An exhibit's chip opens it in brief, and from there its document on the Exhibits view.
  await orders.locator('.prose button.ex').first().click()
  const brief = page.getByTestId('exhibit-brief')
  await expect(brief).toBeVisible()
  await expect(brief.getByRole('button', { name: 'Open exhibit' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(brief).toBeHidden()
  await orders.locator('.prose button.ex').first().click()
  await brief.getByRole('button', { name: 'Open exhibit' }).click()
  await expect(page).toHaveURL(/view=evidence&doc=/)
  await expect(page.getByTestId('trail-detail')).toBeVisible()

  // A link to the note, as search and the overview give, opens it and brings it into view.
  await page.goto(`/o/${org}/w/acme/graph?view=facts&open=${no}`)
  const linked = page.locator(`#note-${no}`)
  await expect(linked.getByRole('button', { name: /^Hide \d+ exhibits?$/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(linked).toBeInViewport()
  await page.context().close()
})

test("facts: a case file's \"more in Facts\" shows exactly the record's findings, not those of a record whose id extends it", async ({ browser }) => {
  const page = await alice(browser)
  // A docket of its own, so the other tests' counts stay as the example has them.
  const ws = await acmeWorkspace(page, org, 'Scoped')
  const token = await createToken(page, org, ws, { scopes: ['docket:read', 'docket:write'], description: 'e2e scoped' })
  const response = await mcp(page.request, `/mcp/${org}/${ws}`, token, 'tools/call', {
    name: 'docket_remember',
    arguments: {
      id: 'service.orders-api',
      type: 'service',
      title: 'Orders API',
      body: 'The public face of service.orders.',
      links: [{ rel: 'depends_on', target: 'datasource.orders-db', evidence: [{ source: 'code', path: 'orders-api/db.go' }] }],
      evidence: [{ source: 'code', path: 'orders-api/main.go' }],
    },
  })
  expect(((await response.json()) as { result?: { isError?: boolean } }).result?.isError).toBeFalsy()

  await page.goto(`/o/${org}/w/${ws}/graph?view=facts&focus=service.orders`)
  const findings = page.getByTestId('inspector').getByTestId('case-findings')
  const count = Number(await findings.locator('h3 span').last().textContent())
  await findings.getByRole('button', { name: /^\d+ more in Facts$/ }).click()
  await expect(page).toHaveURL(/view=facts&focus=service\.orders&about=service\.orders$/)
  const facts = page.getByTestId('fact')
  await expect(facts).toHaveCount(count)
  await expect(facts.filter({ hasText: 'service.orders-api' })).toHaveCount(0)
  await expect(page.getByTestId('facts-count')).toContainText('about Orders')

  // Clearing the scope shows every record's findings again, the prefix-sharing one's among them.
  await page.getByTestId('facts-about-clear').click()
  await expect(page).not.toHaveURL(/about=/)
  await expect(facts.filter({ has: page.getByRole('heading', { name: 'Orders API', exact: true }) })).toHaveCount(1)
  await page.context().close()
})

test('timeline: supersessions, dated evidence and the activity log, by day', async ({ browser }) => {
  const page = await alice(browser)
  await page.goto(`/o/${org}/w/acme/graph?view=timeline`)
  const timeline = page.getByTestId('timeline')
  await expect(timeline.getByTestId('view-timeline')).toHaveCount(0)
  await expect(page.getByTestId('view-timeline')).toHaveAttribute('aria-selected', 'true')
  await expect(timeline.getByTestId('supersession').filter({ hasText: 'Keep order state in Postgres' })).toContainText('Store order state in DynamoDB')

  await timeline.getByTestId('show-change').click()
  await expect(page).toHaveURL(/view=timeline&show=change/)
  const changes = timeline.getByTestId('timeline-entry')
  await expect(changes.filter({ hasText: 'Added evidence' }).filter({ hasText: 'Orders' })).toHaveCount(2)
  await expect(changes.filter({ hasText: 'published the ontology' })).toHaveCount(1)

  await timeline.getByTestId('show-observed').click()
  const observed = timeline.getByTestId('timeline-entry').filter({ hasText: 'orders/main.go' })
  await expect(observed).toHaveCount(1)
  await expect(timeline.locator('time[datetime="2026-10-01"]')).toBeVisible()
  await page.context().close()
})

test('evidence: each document with its evidence, where it came from and the changes that wrote it', async ({ browser }) => {
  const page = await alice(browser)
  const graph = (await (await page.request.get(`/api/o/${org}/w/acme/graph`)).json()) as { entities: { id: string; path: string }[] }
  const path = graph.entities.find((entity) => entity.id === 'service.orders')?.path ?? ''
  expect(path).not.toBe('')

  await page.goto(`/o/${org}/w/acme/graph?view=evidence`)
  const view = page.getByTestId('evidence')
  // Two of the example's documents carry evidence already; the writes above add three.
  await expect(view).toContainText('5 of 21 documents hold evidence, 18 pieces in all')

  // Documents with nothing behind them are one click away.
  await view.getByRole('checkbox', { name: 'No evidence' }).check()
  await expect(page).toHaveURL(/bare=1/)
  await expect(view.getByTestId('trail')).toHaveCount(16)
  await view.getByRole('checkbox', { name: 'No evidence' }).uncheck()

  const [folder, name] = [path.split('/').slice(0, -1).join('/'), path.split('/').at(-1) ?? '']
  await view
    .getByTestId('trail')
    .filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }) })
    .filter({ hasText: folder })
    // Human evidence written through the tools is recorded as the person who gave it.
    .filter({ hasText: '4 exhibits · code, manifest, person' })
    .click()
  await expect(page).toHaveURL(new RegExp(`doc=${encodeURIComponent(path).replace(/\./g, '\\.')}`))
  const detail = view.getByTestId('trail-detail')
  await expect(detail.getByRole('heading', { name: path })).toBeVisible()
  await expect(detail).toContainText('orders/main.go')
  await expect(detail).toContainText('confirmed in the platform review')
  await expect(detail.getByRole('link', { name: 'open the document' })).toHaveAttribute('href', new RegExp(`/documents/`))
  await expect(detail.locator('.changes li')).toHaveCount(2)

  // A deep link opens the same trail.
  await page.reload()
  await expect(detail.getByRole('heading', { name: path })).toBeVisible()
  await page.context().close()
})

test('the timeline and evidence views read the activity log and document origins from their own endpoint, not the board', async ({ browser }) => {
  const page = await alice(browser)
  const history = `/o/${org}/w/acme/graph/history`

  // The board and the facts view never ask for it; the evidence view, opened from a link, does.
  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === history) asked.push(request.url())
  })
  await page.goto(`/o/${org}/w/acme/graph`)
  await expect(page.getByTestId('board')).toBeVisible()
  await page.getByTestId('view-facts').click()
  await expect(page.getByTestId('facts-count')).toBeVisible()
  expect(asked).toHaveLength(0)
  await page.goto(`/o/${org}/w/acme/graph?view=evidence`)
  await expect(page.getByTestId('evidence')).toContainText('5 of 21 documents hold evidence')
  expect(asked).toHaveLength(1)

  const response = await page.request.get(history)
  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    activity: { action: string; actorLabel: string; resourceId: string | null; documents: { path: string; change: string }[] }[]
    documents: { path: string; origin: string; revision: number; createdBy: string; createdAt: string }[]
  }
  const additions = body.activity.filter((entry) => entry.action === 'add-evidence' && entry.resourceId === 'service.orders')
  expect(additions).toHaveLength(2)
  expect(additions[0]?.documents).toHaveLength(1)
  expect(body.documents).toHaveLength(21)
  expect(body.documents.every((document) => document.path && document.origin && document.revision >= 1)).toBe(true)

  // Signed out, it answers 401; in an org the caller is not in, 404.
  const signedOut = await (await browser.newContext()).request.get(history)
  expect(signedOut.status()).toBe(401)
  const carol = await (await browser.newContext()).newPage()
  await signIn(carol, 'carol')
  expect((await carol.request.get(history)).status()).toBe(404)
  await carol.context().close()
  await page.context().close()
})

test('while the history loads, or when it fails, the views say so instead of showing empty counts, and a retry loads it', async ({ browser }) => {
  const page = await alice(browser)
  const history = `**/o/${org}/w/acme/graph/history`
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(history, async (route) => {
    await held
    await route.fulfill({ status: 500, body: 'down' })
  })

  await page.goto(`/o/${org}/w/acme/graph?view=evidence`)
  const pending = page.getByTestId('history-pending')
  await expect(pending).toContainText('Loading the activity log')
  await expect(page.getByTestId('evidence')).toHaveCount(0)

  release()
  await expect(pending.getByRole('alert')).toContainText("Couldn't load the activity log")
  await expect(page.getByTestId('evidence')).toHaveCount(0)

  await page.unroute(history)
  await pending.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTestId('evidence')).toContainText('5 of 21 documents hold evidence')
  await expect(pending).toHaveCount(0)
  await page.context().close()
})

test('a capture that lands while the timeline is loading asks for the history again, so the timeline shows it', async ({ browser }) => {
  const page = await alice(browser)
  await page.goto(`/o/${org}/w/acme/graph`)
  await page.getByTestId('capture-toggle').click()
  const panel = page.getByTestId('capture')
  await panel.getByRole('tab', { name: 'New resource' }).click()
  await panel.getByRole('combobox', { name: 'Type', exact: true }).selectOption('service')
  const title = `Ledger ${unique()}`
  await panel.getByLabel('Title').fill(title)
  const id = await panel.getByLabel('Id').inputValue()
  await panel.getByRole('combobox', { name: 'Source', exact: true }).selectOption('human')
  await panel.getByLabel('Note').fill('captured while the timeline loads')

  // Hold the capture, open the timeline so its history request starts, and hold that too.
  let landCapture: () => void = () => {}
  const captureHeld = new Promise<void>((resolve) => (landCapture = resolve))
  await page.route(
    (url) => url.search.includes('/resource'),
    async (route) => {
      await captureHeld
      await route.continue()
    },
  )
  let answerHistory: () => void = () => {}
  const historyHeld = new Promise<void>((resolve) => (answerHistory = resolve))
  let asked = 0
  await page.route(`**/o/${org}/w/acme/graph/history`, async (route) => {
    asked++
    await historyHeld
    await route.continue()
  })
  await panel.getByRole('button', { name: 'Capture service' }).click()
  await page.getByTestId('view-timeline').click()
  await expect(page.getByTestId('history-pending')).toContainText('Loading the activity log')
  await expect.poll(() => asked).toBe(1)

  // The capture lands first: the history asked for before it is stale, so it is asked for again.
  landCapture()
  await expect(page.getByText(`Captured ${id}.`)).toBeVisible()
  await expect.poll(() => asked).toBe(2)
  answerHistory()

  const timeline = page.getByTestId('timeline')
  await timeline.getByTestId('show-change').click()
  await expect(timeline.getByTestId('timeline-entry').filter({ hasText: title })).toHaveCount(1)
  await expect(page.getByTestId('history-pending')).toHaveCount(0)
  await page.context().close()
})
