// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, signIn, unique } from './helpers'

/**
 * The Ask page: one or many of the org's workspaces, asked in words through
 * docket's grounded ask (the MCP endpoint's `docket_ask` path) and answered
 * as a memorandum per docket in a top-down chat saved for its member, or
 * searched directly without a model - notes, memory matches, records,
 * exhibits and docket entries, the records by text, type and tag, as a list
 * or on the map - and the command menu (⌘K) that searches the same way.
 */

/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

let org = ''

test.beforeAll(async ({ browser }) => {
  // Two workspaces and, with the worker, both indexes to wait for.
  test.setTimeout(150_000)
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Ask ${unique()}`)
  await acmeWorkspace(page, org, 'Acme')
  await acmeWorkspace(page, org, 'Mirror')
  if (WORKER) {
    for (const ws of ['acme', 'mirror']) {
      await page.goto(`/a/${org}/d/${ws}/graph`)
      await expect(page.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
    }
  }
  await page.context().close()
})

/** Opens the scope chip's list of dockets. */
async function openScope(page: Page) {
  await page.getByTestId('scope').locator('summary').click()
  await expect(page.getByTestId('workspace-picker')).toBeVisible()
}

async function openAsk(page: Page) {
  await signIn(page, 'alice')
  await page.goto(`/a/${org}`)
  await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: 'Chat' }).click()
  await expect(page).toHaveURL(`/a/${org}/ask`)
}

test('search finds every kind of result in every chosen workspace, filters the records, and draws them on the map', async ({ page }) => {
  await openAsk(page)
  await page.getByRole('navigation', { name: 'Ask or search' }).getByRole('link', { name: 'Search · no AI' }).click()
  const form = page.getByRole('form', { name: 'Search the dockets' })
  await form.getByLabel('Search text').fill('orders')
  await form.getByRole('button', { name: 'Search' }).click()

  // All lists the first few of each kind; each kind's tab lists every one. The first search warms the index, which can take a while on a cold runner.
  await expect(page.getByTestId('search-count')).toContainText('no AI', { timeout: 15_000 })
  await expect(page.getByTestId('group-notes')).toBeVisible()
  await expect(page.getByTestId('group-exhibits')).toBeVisible()
  await expect(page.getByTestId('group-entries')).toBeVisible()
  if (WORKER) await expect(page.getByTestId('group-memory')).toBeVisible()
  await page.getByRole('tab', { name: /^Records/ }).click()
  const hits = page.getByTestId('search-hit')
  await expect(hits.first()).toBeVisible()
  // The same resource in both workspaces is two hits, each naming its workspace.
  await expect(page.locator('[data-testid="search-hit"][data-id="service.orders"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="search-hit"][data-workspace="acme"][data-id="service.orders"]')).toContainText('Acme')
  await expect(page.locator('[data-testid="search-hit"][data-workspace="mirror"][data-id="service.orders"]')).toContainText('Mirror')

  // A tag narrows the records to what carries it; the filter applies at once and stays in the URL.
  await page.getByText('Filter and show records').click()
  await page.getByRole('checkbox', { name: /^tier-1/ }).check()
  await expect(page).toHaveURL(/tag=tier-1/)
  await page.getByRole('tab', { name: /^Records/ }).click()
  await expect(hits).toHaveCount(2)
  await expect(page.locator('[data-testid="search-hit"]:not([data-id="service.orders"])')).toHaveCount(0)

  // One workspace only.
  await openScope(page)
  await form.getByRole('checkbox', { name: /^Mirror/ }).uncheck()
  await expect(page).not.toHaveURL(/ws=mirror/)
  await page.getByRole('tab', { name: /^Records/ }).click()
  await expect(hits).toHaveCount(1)
  await expect(hits.first()).toHaveAttribute('data-workspace', 'acme')

  // Filters alone list without any text, and the map draws the matches with what they link to.
  await form.getByLabel('Search text').fill('')
  await page.getByRole('checkbox', { name: /^team/ }).check()
  await expect(page).toHaveURL(/type=team/)
  await page.getByRole('checkbox', { name: /^tier-1/ }).uncheck()
  await expect(page).not.toHaveURL(/tag=tier-1/)
  await page.getByRole('tab', { name: /^Records/ }).click()
  await expect(hits.first()).toBeVisible()
  for (const hit of await hits.all()) expect(await hit.getAttribute('data-id')).toMatch(/^team\./)
  await page.getByRole('radio', { name: 'On the map' }).check()
  await expect(page).toHaveURL(/view=graph/)
  await page.getByRole('tab', { name: /^Records/ }).click()
  const board = page.getByTestId('search-board')
  await expect(board).toBeVisible()
  expect(Number(await board.getAttribute('data-matched'))).toBeGreaterThan(0)
  expect(Number(await board.getAttribute('data-nodes'))).toBeGreaterThan(Number(await board.getAttribute('data-matched')))
})

test('the scope chip’s "only" button scopes to one docket in a single click, without unchecking the others by hand', async ({ page }) => {
  await openAsk(page)
  await openScope(page)
  const picker = page.getByTestId('workspace-picker')
  await picker.getByRole('button', { name: 'Ask Mirror only' }).click()
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Mirror/)
  await expect(picker.locator('input[type="checkbox"]:checked')).toHaveCount(1)
  await expect(picker.getByRole('checkbox', { name: /^Mirror/ })).toBeChecked()
  await expect(picker.getByRole('checkbox', { name: /^Acme/ })).not.toBeChecked()

  // All dockets, back in one click too.
  await page.getByRole('button', { name: 'All dockets' }).click()
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/All 2 dockets/)
  await expect(picker.locator('input[type="checkbox"]:checked')).toHaveCount(2)
})

test('clearing every docket in search mode hides the stale results and blocks searching until one is chosen again', async ({ page }) => {
  await openAsk(page)
  await page.getByRole('navigation', { name: 'Ask or search' }).getByRole('link', { name: 'Search · no AI' }).click()
  const form = page.getByRole('form', { name: 'Search the dockets' })
  await form.getByLabel('Search text').fill('orders')
  await form.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByTestId('search-count')).toContainText('no AI', { timeout: 15_000 })

  // Down to the second-to-last docket: still resubmits and shows that docket's results.
  await openScope(page)
  await form.getByRole('checkbox', { name: /^Mirror/ }).uncheck()
  await expect(page).not.toHaveURL(/ws=mirror/)
  await expect(page).toHaveURL(/ws=acme/)
  await expect(page.getByTestId('search-count')).toContainText('no AI', { timeout: 15_000 })

  // Unchecking the very last docket does not resubmit: it hides the (now stale) results and prompts instead.
  // The picker stays open across that client-side navigation, so it is not reopened here.
  const url = page.url()
  await form.getByRole('checkbox', { name: /^Acme/ }).uncheck()
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Choose dockets/)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('search-count')).toHaveCount(0)
  await expect(page.getByText('Choose at least one docket to search.')).toBeVisible()

  // The Search button is disabled, and pressing Enter in the field does not submit either.
  await expect(form.getByRole('button', { name: 'Search' })).toBeDisabled()
  await form.getByLabel('Search text').fill('checkout')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(url)
  await expect(page.getByText('Choose at least one docket to search.')).toBeVisible()
})

test('a question goes to each chosen workspace, cites sources by workspace, and is saved until deleted', async ({ page }) => {
  // Two real asks through the index, each of which can take a while on a cold runner.
  test.setTimeout(90_000)
  await openAsk(page)
  // Every docket, until the scope chip chooses otherwise; its list stays folded until opened.
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/All 2 dockets/)
  await expect(page.getByTestId('workspace-picker').locator('input[type="checkbox"]:checked')).toHaveCount(2)
  await page.getByLabel('Question').fill('Who owns the orders service?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()

  // The chat is saved, and its URL set, once docket has answered from every workspace.
  await expect(page).toHaveURL(new RegExp(`/a/${org}/ask\\?chat=[0-9a-f-]{36}$`), { timeout: 30_000 })
  await expect(page.getByTestId('question')).toHaveText(/Who owns the orders service\?/)
  const parts = page.getByTestId('workspace-answer')
  await expect(parts).toHaveCount(2)
  await expect(parts.nth(0)).toHaveAttribute('data-workspace', 'acme')
  await expect(parts.nth(1)).toHaveAttribute('data-workspace', 'mirror')
  if (WORKER) {
    // No OpenRouter key in the suite: docket's grounded answer without a summary, a memorandum per workspace, drawn from it.
    await expect(parts.nth(0).getByTestId('answer-notice')).toContainText('AI is not set up')
    await expect(parts.nth(0)).toContainText(/Drawn from\s*Acme/)
    await expect(parts.nth(1)).toContainText(/Drawn from\s*Mirror/)
    await expect(parts.nth(0).getByTestId('source').first()).toBeVisible()
    await expect(parts.nth(0).locator('[data-testid="source"][data-id="service.orders"]')).toBeVisible()
  } else {
    await expect(parts.nth(0).getByRole('alert')).toContainText('The search index is not running')
  }

  // Saved: the chat is in the list and opens again after a reload.
  const chats = page.getByRole('complementary', { name: 'Saved chats' })
  await expect(chats.getByRole('link', { name: /Who owns the orders service\?/ })).toHaveAttribute('aria-current', 'page')
  const url = page.url()
  await page.reload()
  await expect(page.getByTestId('question')).toHaveCount(1)

  // A follow-up to one workspace joins the same chat.
  await openScope(page)
  await page.getByTestId('workspace-picker').getByRole('checkbox', { name: /^Mirror/ }).uncheck()
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Acme/)
  await page.getByLabel('Question').fill('What does checkout depend on?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByTestId('question')).toHaveCount(2, { timeout: 30_000 })
  await expect(page.getByTestId('answer').last().getByTestId('workspace-answer')).toHaveCount(1)
  expect(page.url()).toBe(url)

  // The composer stays at the bottom of the window, cleared for the next question, while the messages scroll above it
  // with no scrollbar showing; the page itself never scrolls.
  await expect(page.getByLabel('Question')).toHaveValue('')
  await expect(page.locator('form.chat-composer')).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.chat-scroll')).toHaveCSS('scrollbar-width', 'none')
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  // The org sidebar scrolls on its own within the window instead of being cut off.
  await page.setViewportSize({ width: 1280, height: 300 })
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
  await expect(sidebar).toHaveCSS('overflow-y', 'auto')
  await sidebar.getByRole('link', { name: 'Settings' }).scrollIntoViewIfNeeded()
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('form.chat-composer')).toBeInViewport()
  await expect(sidebar).not.toHaveCSS('overflow-y', 'auto')
  // On a phone the chat fills the screen above the tab bar: the newest turn scrolls in above the composer, not behind it.
  const gap = await page.getByTestId('answer').last().evaluate((turn) => {
    turn.scrollIntoView({ block: 'end' })
    return document.querySelector('form.chat-composer')!.getBoundingClientRect().top - turn.getBoundingClientRect().bottom
  })
  // Within a pixel: the turn ends where the conversation does, rounded.
  expect(gap).toBeGreaterThanOrEqual(-1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  if (WORKER) {
    // A source opens in its workspace's Record, on that record.
    const link = page.getByTestId('answer').first().locator('[data-workspace="acme"] [data-testid="source"][data-id="service.orders"]').getByRole('link')
    await expect(link).toHaveAttribute('href', `/a/${org}/d/acme/graph?focus=service.orders`)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/a/${org}/d/acme/graph\\?focus=service\\.orders$`))
    await expect(page.getByTestId('inspector').getByRole('heading', { name: 'Orders', level: 2 })).toBeVisible()
    await page.goto(url)
  }

  await page.getByRole('button', { name: 'Delete chat' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL(`/a/${org}/ask`)
  await expect(chats.getByRole('link', { name: /Who owns the orders service\?/ })).toHaveCount(0)
  expect((await page.goto(url))?.status()).toBe(404)
})

test('a question needs words and a workspace', async ({ page }) => {
  await openAsk(page)
  await openScope(page)
  for (const box of await page.getByTestId('workspace-picker').getByRole('checkbox').all()) await box.uncheck()
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Choose dockets/)
  await page.getByLabel('Question').fill('Anything?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Choose at least one docket to ask.')
  await expect(page.getByLabel('Question')).toHaveValue('Anything?')
})

test('a docket’s Chat tab asks that docket alone, and every way into Ask keeps the docket and remembers the scope', async ({ page }) => {
  test.setTimeout(60_000)
  await signIn(page, 'alice')
  await page.goto(`/a/${org}/d/acme/overview`)
  await page.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(page).toHaveURL(`/a/${org}/d/acme/ask`)
  await expect(page.getByTestId('scope')).toContainText('asking Acme only')
  await expect(page.getByTestId('workspace-picker')).toHaveCount(0)
  await page.getByLabel('Question').fill('Which teams are on call?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()

  // The answer is saved to a chat on the tab, asked of Acme alone.
  await expect(page).toHaveURL(new RegExp(`/a/${org}/d/acme/ask\\?chat=[0-9a-f-]{36}$`), { timeout: 30_000 })
  await expect(page.getByTestId('question')).toContainText('asked of Acme')
  await expect(page.getByTestId('question')).not.toContainText('Mirror')
  const chats = page.getByRole('complementary', { name: 'Saved chats' })
  await expect(chats.getByRole('link', { name: /Which teams are on call\?/ })).toHaveAttribute('aria-current', 'page')
  // Mirror's tab lists only the chats asking Mirror alone.
  await page.goto(`/a/${org}/d/mirror/ask`)
  await expect(chats.getByRole('link', { name: /Which teams are on call\?/ })).toHaveCount(0)

  // From inside a docket, the sidebar's Ask opens on it, and New chat keeps it.
  await page.goto(`/a/${org}/d/acme/overview`)
  await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: 'Chat' }).click()
  await expect(page).toHaveURL(`/a/${org}/ask?ws=acme`)
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Acme/)
  await expect(page.getByTestId('new-chat').first()).toHaveAttribute('href', `/a/${org}/ask?ws=acme`)
  // The scope is remembered: Ask's bare address keeps Acme instead of resetting to every docket.
  await page.goto(`/a/${org}/ask`)
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/Acme/)
  await page.getByTestId('scope').locator('summary').click()
  await page.getByRole('button', { name: 'All dockets' }).click()
  await page.goto(`/a/${org}/ask`)
  await expect(page.getByTestId('scope').locator('summary')).toHaveText(/All 2 dockets/)

  // A phone keeps the chip on one line under the composer, without the page scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/a/${org}/d/acme/ask`)
  await expect(page.locator('form.chat-composer')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('the command menu finds records and the rest, jumps to pages, and hands the words to Ask', async ({ page }) => {
  await signIn(page, 'alice')
  await page.goto(`/a/${org}/d/acme/overview`)
  // The sidebar's search field opens it, as ⌘K (Ctrl+K) does from anywhere; clicked again until the page has hydrated.
  const menu = page.getByRole('dialog', { name: 'Search or jump to' })
  await expect(async () => {
    await page.getByRole('button', { name: 'Search or jump to…' }).click()
    await expect(menu).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(menu).toBeVisible()

  // In a docket it searches that docket: a record by its name, and the kinds besides.
  await menu.getByRole('combobox').fill('orders')
  const options = menu.getByRole('option')
  await expect(menu.locator('[role="option"][data-group="Records"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(menu.locator('[role="option"][data-group="Exhibits"]').first()).toBeVisible()
  await expect(options.filter({ hasText: 'Search everything for “orders”' })).toBeVisible()
  await options.filter({ hasText: 'Search everything for “orders”' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${org}/ask\\?mode=search&q=orders&ws=acme$`))
  await expect(page.getByTestId('group-exhibits')).toBeVisible()

  // A page by its name, with the keyboard: outside a docket, the casebook's pages.
  await page.keyboard.press('ControlOrMeta+k')
  await menu.getByRole('combobox').fill('users')
  await expect(options.first()).toHaveText(/Users/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/a/${org}/members`)

  // The words, asked: Ask opens on the docket and sends them, as a new chat. Reached in the page, so ⌘K finds it hydrated.
  await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: /^Acme/ }).click()
  await expect(page).toHaveURL(`/a/${org}/d/acme/overview`)
  await page.keyboard.press('ControlOrMeta+k')
  await menu.getByRole('combobox').fill('Who owns checkout?')
  await options.filter({ hasText: 'Ask: “Who owns checkout?”' }).click()
  await expect(page).toHaveURL(new RegExp(`/a/${org}/ask\\?chat=[0-9a-f-]{36}$`), { timeout: 30_000 })
  await expect(page.getByTestId('question')).toHaveText(/Who owns checkout\?/)
  await expect(page.getByTestId('workspace-answer')).toHaveCount(1)
})
