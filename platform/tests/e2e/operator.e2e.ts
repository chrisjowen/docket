// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

/**
 * The operator console (tenancy v2 phase 6.3), for the platform's operators
 * alone (alice here): every account, with its owners and counts but nothing
 * of its content; suspend and resume one, and set its own limits.
 */
test('the operator console suspends and resumes an account, and sets its limits, for an operator alone', async ({ browser }) => {
  const carol = await (await browser.newContext()).newPage()
  await signIn(carol, 'carol')
  const name = `Suspend me ${unique()}`
  const slug = await createOrg(carol, name)
  // Not an operator: there is no such page.
  expect((await carol.goto('/admin'))?.status()).toBe(404)
  expect((await carol.goto('/admin/accounts'))?.status()).toBe(404)

  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  await alice.goto('/admin')
  await expect(alice).toHaveURL(/\/admin\/accounts$/)
  await expect(alice.getByRole('heading', { name: 'Operator console' })).toBeVisible()
  const row = alice.locator(`tr[data-account="${slug}"]`)
  await expect(row).toContainText(name)
  await expect(row).toContainText('@carol')
  await expect(row.getByText('active', { exact: true })).toBeVisible()

  // Its own docket limit.
  await row.getByText('Change').click()
  await row.getByLabel('Dockets').fill('3')
  await row.getByRole('button', { name: 'Set limits' }).click()
  await expect(alice.getByRole('status')).toContainText(`Set ${name}'s limits.`)
  await expect(alice.locator(`tr[data-account="${slug}"] td[data-label="Dockets"]`)).toHaveText('3')

  // Suspended, its pages are not served, even to its owner; nothing is lost, and resumed it is back.
  await alice.locator(`tr[data-account="${slug}"]`).getByText('Change').click()
  await alice.locator(`tr[data-account="${slug}"]`).getByLabel(/^Why/).fill('e2e')
  await alice.locator(`tr[data-account="${slug}"]`).getByRole('button', { name: `Suspend ${name}` }).click()
  await expect(alice.getByRole('status')).toContainText(`Suspended ${name}.`)
  await expect(alice.locator(`tr[data-account="${slug}"]`)).toContainText('by @alice: e2e')
  expect((await carol.goto(`/a/${slug}`))?.status()).toBe(404)

  await alice.locator(`tr[data-account="${slug}"]`).getByText('Change').click()
  await alice.locator(`tr[data-account="${slug}"]`).getByRole('button', { name: `Resume ${name}` }).click()
  await expect(alice.getByRole('status')).toContainText(`Resumed ${name}.`)
  expect((await carol.goto(`/a/${slug}`))?.status()).toBe(200)
})

test('the operator console fits a phone', async ({ page }) => {
  await signIn(page, 'alice')
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/admin/accounts', '/admin/waitlist']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
