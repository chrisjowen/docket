// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { requestRole, signIn, unique } from './helpers'

/** The waitlist row for an email or a GitHub login, read as the app's request role. */
async function entry(where: { email?: string; login?: string }) {
  const db = requestRole()
  await db.connect()
  try {
    const { rows } = where.email
      ? await db.query('SELECT * FROM platform.waitlist WHERE email = $1', [where.email])
      : await db.query('SELECT * FROM platform.waitlist WHERE github_login = $1', [where.login])
    return rows
  } finally {
    await db.end()
  }
}

test.describe('the beta waitlist', () => {
  test('a visitor at / is sent to sign in, and someone signed in sees the app', async ({ page, browser }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/signin$/)

    const signedIn = await (await browser.newContext()).newPage()
    await signIn(signedIn, 'alice')
    await signedIn.goto('/')
    await expect(signedIn.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
  })

  test('signing in with GitHub off the list joins the waitlist, and grants nothing', async ({ page }) => {
    const login = `gh${unique()}`
    await signIn(page, login, { email: `${login}@example.test` })

    await expect(page).toHaveURL(/\/signin\/invite-only$/)
    await expect(page.getByText("You're on the waitlist")).toBeVisible()
    await page.getByLabel('Team name').fill('Octo Team')
    await page.getByLabel('Team size').selectOption('21-50')
    await page.getByRole('button', { name: 'Send details' }).click()
    await expect(page.getByText("Thanks: we have your team's details")).toBeVisible()

    const rows = await entry({ login })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ via: 'github', email: `${login}@example.test`, team_name: 'Octo Team', team_size: '21-50', status: 'waiting' })
    expect(rows[0].github_id).not.toBeNull()
    expect((await page.context().cookies()).find((cookie) => cookie.name === 'docket_session')).toBeUndefined()

    // Signing in again keeps one entry.
    await signIn(page, login)
    expect(await entry({ login })).toHaveLength(1)
  })

  test('only a platform admin sees the waitlist, and an invite lets the person in', async ({ page, browser }) => {
    const login = `inv${unique()}`
    const joiner = await (await browser.newContext()).newPage()
    await signIn(joiner, login, { email: `${login}@example.test` })
    await expect(joiner).toHaveURL(/\/signin\/invite-only$/)

    // Signed out: sign in first. Signed in but not an admin: there is no such page.
    await page.goto('/admin/waitlist')
    await expect(page).toHaveURL(/\/signin\?next=%2Fadmin%2Fwaitlist$/)
    await signIn(page, 'carol')
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Operator console' })).toHaveCount(0)
    expect((await page.goto('/admin/waitlist'))?.status()).toBe(404)
    expect((await page.goto('/admin/accounts'))?.status()).toBe(404)
    const csrf = await page.locator('input[name="csrf"]').first().inputValue()
    const [row] = await entry({ login })
    const forbidden = await page.request.post('/admin/waitlist?/invite', {
      form: { csrf, entry: row.id },
      headers: { origin: new URL(page.url()).origin },
      maxRedirects: 0,
    })
    expect(forbidden.status()).toBe(404)
    expect((await entry({ login }))[0]).toMatchObject({ status: 'waiting' })

    const admin = await (await browser.newContext()).newPage()
    await signIn(admin, 'alice')
    // The waitlist is a tab of the operator console, which opens on its accounts.
    await admin.getByRole('link', { name: 'Operator console' }).click()
    await expect(admin).toHaveURL(/\/admin\/accounts$/)
    await admin.getByRole('navigation', { name: 'Operator console' }).getByRole('link', { name: 'Waitlist' }).click()
    await expect(admin).toHaveURL(/\/admin\/waitlist$/)
    await expect(admin.getByRole('heading', { name: 'Beta waitlist' })).toBeVisible()
    const listed = admin.getByRole('row').filter({ hasText: `@${login}` })
    await expect(listed).toContainText('verified')
    await listed.getByRole('button', { name: /^Invite/ }).click()
    await expect(admin.getByRole('status')).toContainText(`@${login} can sign in now`)
    await admin.goto('/admin/waitlist?status=invited')
    await expect(admin.getByRole('row').filter({ hasText: `@${login}` })).toContainText('by @alice')

    expect((await entry({ login }))[0]).toMatchObject({ status: 'invited' })
    await signIn(joiner, login)
    await expect(joiner.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
  })
})
