// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

/**
 * Spaces (tenancy v2 phase 3): Account › Space › Docket. Every account starts
 * with General, which everyone at the account reads. In the sidebar spaces sit
 * under Spaces +, which an admin on the account uses to make one, and each
 * space has its own + for a new docket. New docket is its own page with the
 * space already chosen, and initial access. A role on a space covers every
 * docket in it; whoever manages access on a space invites new people into it.
 */

async function newDocket(page: Page, name: string, options: { access?: { who: string; role: string } } = {}) {
  await page.getByLabel('Name').fill(name)
  await page.getByText('Blank', { exact: true }).click()
  if (options.access) {
    await page.getByRole('button', { name: 'Give someone access to this docket' }).click()
    await page.getByLabel('Who, line 1').selectOption({ label: options.access.who })
    await page.getByLabel('Role, line 1').selectOption({ label: options.access.role })
  }
  await page.getByRole('button', { name: 'Create docket' }).click()
}

test('Spaces + makes a space, its + opens New docket with the space chosen, and a role on a space covers its dockets', async ({ browser }) => {
  const suffix = unique()
  const bob = `bob${suffix}`
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  const slug = await createOrg(alice, `Spaces ${suffix}`)

  // Every account starts with General.
  const sidebar = alice.getByRole('navigation', { name: 'Sidebar' })
  await expect(sidebar.getByRole('list', { name: 'Spaces' }).getByRole('link', { name: 'General', exact: true })).toBeVisible()

  // Spaces + (an admin on the account): Engineering, then who gets access to it.
  await sidebar.getByTestId('new-space').click()
  await alice.getByLabel('Name').fill('Engineering')
  await alice.getByRole('button', { name: 'Create space' }).click()
  await expect(alice).toHaveURL(`/a/${slug}/s/engineering/access`)
  await expect(alice.getByTestId('your-access')).toContainText('Owner')

  // Whoever manages access on a space invites someone new straight into it.
  await alice.getByLabel('GitHub login or email').fill(bob)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('writer')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  await expect(alice.getByText(`Invited @${bob} as Writer on Engineering.`)).toBeVisible()

  // The space's own +: New docket, in Engineering, with no choice of space.
  await sidebar.getByTestId('new-docket-in-engineering').click()
  await expect(alice).toHaveURL(`/a/${slug}/s/engineering/new`)
  await expect(alice.getByTestId('new-docket-space')).toContainText('Engineering')
  await expect(alice.locator('select[name="space"]')).toHaveCount(0)
  await newDocket(alice, 'Payments')
  await expect(alice).toHaveURL(`/a/${slug}/d/payments/ontology`)
  await expect(sidebar.getByRole('list', { name: 'Dockets in Engineering' }).getByRole('link', { name: /Payments/ })).toBeVisible()

  // The old address still opens New docket: in General.
  await alice.goto(`/a/${slug}/dockets/new`)
  await expect(alice).toHaveURL(`/a/${slug}/s/general/new`)
  await newDocket(alice, 'Handbook')
  await expect(alice).toHaveURL(`/a/${slug}/d/handbook/ontology`)

  // A third space, whose docket Bob is given on its own, as its initial access.
  await sidebar.getByTestId('new-space').click()
  await alice.getByLabel('Name').fill('Legal')
  await alice.getByRole('button', { name: 'Create space' }).click()
  await alice.goto(`/a/${slug}/s/legal/new`)
  await expect(alice.getByTestId('initial-access')).toContainText('Initial access')
  // Bob is not a member yet, so only everyone is offered.
  await newDocket(alice, 'Contracts', { access: { who: `Everyone at Spaces ${suffix}`, role: 'Reader' } })
  await expect(alice).toHaveURL(`/a/${slug}/d/contracts/ontology`)
  await alice.goto(`/a/${slug}/s/legal/new`)
  await newDocket(alice, 'Litigation')
  await expect(alice).toHaveURL(`/a/${slug}/d/litigation/ontology`)

  // Bob joins: Writer on Engineering covers Payments; General he reads, as everyone does; Legal he sees but only Contracts opens.
  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob)
  await bobPage.getByRole('button', { name: `Accept and join Spaces ${suffix}` }).click()
  await bobPage.goto(`/a/${slug}/d/payments/access`)
  await expect(bobPage.getByTestId('your-access')).toContainText('Can write')
  await expect(bobPage.getByTestId('your-access')).toContainText('Writer on Engineering (space)')
  await bobPage.goto(`/a/${slug}/d/handbook/access`)
  await expect(bobPage.getByTestId('your-access')).toContainText('Can read')
  await expect(bobPage.getByTestId('your-access')).toContainText('Reader on General (space), given to everyone')
  await bobPage.goto(`/a/${slug}/d/contracts/access`)
  await expect(bobPage.getByTestId('your-access')).toContainText('Reader on this docket, given to everyone')
  expect((await bobPage.request.get(`/a/${slug}/d/litigation/overview`)).status()).toBe(403)
  await bobPage.goto(`/a/${slug}/s/legal`)
  await expect(bobPage.locator('[data-docket="litigation"]')).toContainText('You have no access to this docket.')

  // A Writer neither adds dockets nor makes spaces.
  await bobPage.goto(`/a/${slug}/s/engineering`)
  await expect(bobPage.getByTestId('space-access')).toHaveText('Can write')
  await expect(bobPage.getByTestId('space-new-docket')).toHaveCount(0)
  await expect(bobPage.getByRole('navigation', { name: 'Sidebar' }).getByTestId('new-space')).toHaveCount(0)
  expect((await bobPage.request.get(`/a/${slug}/s/engineering/new`)).status()).toBe(403)
  expect((await bobPage.request.get(`/a/${slug}/spaces/new`)).status()).toBe(403)
  expect((await bobPage.request.get(`/a/${slug}/s/nowhere`)).status()).toBe(404)
})

test('the space pages and New docket fit a phone', async ({ page }) => {
  await signIn(page, 'alice')
  const slug = await createOrg(page, `Phone ${unique()}`)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of [`/a/${slug}/s/general`, `/a/${slug}/s/general/access`, `/a/${slug}/s/general/new`, `/a/${slug}/spaces/new`]) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
  // The sidebar is a drawer on a phone, and holds the spaces.
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: 'General', exact: true })).toBeVisible()
})
