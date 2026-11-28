// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { csrfOf, signIn, unique } from './helpers'

test.describe('sign-in', () => {
  test('non-allowlisted login sees invite-only page, on the waitlist', async ({ page }) => {
    const login = `mallory${unique()}`
    await signIn(page, login)
    await expect(page).toHaveURL(/\/signin\/invite-only$/)
    await expect(page.getByRole('heading', { name: 'Docket Cloud is invite-only for now', exact: true })).toBeVisible()
    await expect(page.getByText(`@${login}`)).toBeVisible()
    await expect(page.getByText("You're on the waitlist")).toBeVisible()

    // No session was made: / sends the visitor to sign in.
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)
    await page.goto('/a/anything')
    await expect(page).toHaveURL(/\/signin\?next=%2Fa%2Fanything$/)

    await page.goto('/signin/invite-only')
    await page.getByLabel('Email').fill(`${login}@example.test`)
    await page.getByLabel('Team name').fill('Mallory Inc')
    await page.getByRole('button', { name: 'Send details' }).click()
    await expect(page.getByText("Thanks: we have your team's details")).toBeVisible()
  })

  test('an allowlisted login signs in, and signs out', async ({ page }) => {
    await signIn(page, 'alice', { name: 'Alice Archer' })
    await expect(page.getByRole('heading', { name: 'Welcome, Alice Archer' })).toBeVisible()
    const cookies = await page.context().cookies()
    const session = cookies.find((cookie) => cookie.name === 'docket_session')
    expect(session?.httpOnly).toBe(true)
    expect(session?.sameSite).toBe('Lax')

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/signin$/)
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)
  })

  test('a signed-out visitor is sent to sign in and back', async ({ page }) => {
    await page.goto('/a/anything/members')
    await expect(page).toHaveURL(/\/signin\?next=%2Fa%2Fanything%2Fmembers$/)
  })

  test('a mutation without the CSRF token is refused', async ({ page }) => {
    await signIn(page, 'alice')
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible()
    const refused = await page.request.post('/orgs/new', {
      form: { name: 'No Token', slug: `no-token-${unique()}` },
      headers: { origin: new URL(page.url()).origin },
    })
    expect(refused.status()).toBe(403)

    const wrong = await page.request.post('/signout', {
      form: { csrf: 'not-the-token' },
      headers: { origin: new URL(page.url()).origin },
      maxRedirects: 0,
    })
    expect(wrong.status()).toBe(403)

    const right = await page.request.post('/signout', {
      form: { csrf: await csrfOf(page) },
      headers: { origin: new URL(page.url()).origin },
      maxRedirects: 0,
    })
    expect(right.status()).toBe(303)
  })
})
