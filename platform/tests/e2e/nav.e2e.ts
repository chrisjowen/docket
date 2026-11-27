// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

/**
 * The sidebar lists the casebook's dockets under the casebook; a docket opens
 * on its overview, and its sections are tabs across the top of every docket
 * page, with the breadcrumbs leading back up.
 */
test('a docket opens on its overview, with its sections as tabs, and the old address redirects there', async ({ page }) => {
  await signIn(page, 'alice')
  const slug = await createOrg(page, `Nav ${unique()}`)
  await page.goto(`/o/${slug}/workspaces/new`)
  await page.getByLabel('Name').fill('Platform')
  await page.getByText('Blank', { exact: true }).click()
  await page.getByRole('button', { name: 'Create docket' }).click()
  const ws = `/o/${slug}/w/platform`
  await expect(page).toHaveURL(`${ws}/ontology`)

  // The casebook lists the docket with its docket number; the sidebar's docket link opens its overview.
  await page.goto(`/o/${slug}`)
  await expect(page.getByRole('heading', { level: 1, name: 'The casebook' })).toBeVisible()
  await expect(page.getByRole('table').getByRole('row', { name: /Platform/ })).toContainText(/PLA-\d{2}-0001/)
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
  await expect(sidebar.getByRole('link', { name: 'Casebook' })).toHaveAttribute('aria-current', 'page')
  await sidebar.getByRole('list', { name: 'Dockets' }).getByRole('link', { name: /Platform/ }).click()
  await expect(page).toHaveURL(`${ws}/overview`)
  await expect(sidebar.getByRole('link', { name: /Platform/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1, name: 'In re Platform' })).toBeVisible()
  await expect(page.getByTestId('docket-no')).toHaveText(/^PLA-\d{2}-0001$/)
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs.getByRole('link')).toHaveText([/Nav /])
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Platform')

  const tabs = page.getByRole('navigation', { name: 'Docket' })
  await expect(tabs.getByRole('link')).toHaveText(['Overview', 'Record', 'Chat', 'Proposals', 'Documents', 'Schema', 'Activity', 'MCP', 'Repos', 'Settings'])
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Overview')

  // Each tab opens its section and marks itself current; nested pages keep their section's tab.
  for (const [label, path] of [
    ['Record', 'graph'],
    ['Chat', 'ask'],
    ['Proposals', 'proposals'],
    ['Documents', 'documents'],
    ['Schema', 'ontology'],
    ['Activity', 'activity'],
    ['MCP', 'mcp'],
    ['Repos', 'repos'],
    ['Settings', 'settings'],
  ]) {
    await tabs.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(`${ws}/${path}`)
    await expect(tabs.locator('[aria-current="page"]')).toHaveText(label)
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(label)
  }
  await expect(page.getByTestId('address')).toHaveText(`/o/${slug}/w/platform`)
  await page.goto(`${ws}/ontology/history`)
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Schema')
  await expect(crumbs.getByRole('link', { name: 'Schema' })).toHaveAttribute('href', `${ws}/ontology`)

  // The docket's bare address redirects to its overview; with a query, which only the graph read, to the graph.
  await page.goto(ws)
  await expect(page).toHaveURL(`${ws}/overview`)
  const redirect = await page.request.get(ws, { maxRedirects: 0 })
  expect(redirect.status()).toBe(307)
  expect(redirect.headers().location).toBe(`${ws}/overview`)
  const focused = await page.request.get(`${ws}?focus=team.core`, { maxRedirects: 0 })
  expect(focused.headers().location).toBe(`${ws}/graph?focus=team.core`)

  // A docket the casebook does not have is 404, not a redirect.
  const missing = await page.request.get(`/o/${slug}/w/nosuch`, { maxRedirects: 0 })
  expect(missing.status()).toBe(404)
})

test('the theme toggle switches to dark and the server remembers it', async ({ page }) => {
  await signIn(page, 'alice')
  const slug = await createOrg(page, `Theme ${unique()}`)
  await page.goto(`/o/${slug}`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
