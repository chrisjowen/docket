// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, csrfOf, signIn, unique } from './helpers'

/**
 * G1 (spec §1): an invited user signs in with GitHub, creates an org, invites
 * a second user as a Writer on the whole account, and the second user can
 * write but not publish the ontology.
 */
test('G1: create an org, invite a writer who can write but not publish', async ({ browser }) => {
  const suffix = unique()
  const bob = `bob${suffix}`

  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice', { name: 'Alice Archer' })
  const slug = await createOrg(alice, `Acme ${suffix}`)
  await expect(alice.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(alice.locator(`tr[data-login="alice"] [data-testid="role"]`)).toHaveText('Owner')

  await alice.getByLabel('GitHub login or email').fill(`@${bob}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('writer')
  // New invites default to General; this one is for the whole account.
  await alice.locator('form[action="?/invite"] select[name="place"]').selectOption('account')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  await expect(alice.getByText(`@${bob} is invited as Writer on Acme ${suffix} (the whole account).`)).toBeVisible()
  // And it is listed among the pending invites.
  await expect(alice.getByRole('listitem').filter({ hasText: `@${bob} Writer on Acme ${suffix}` })).toBeVisible()

  // Bob is not on the beta list; the pending invite admits him.
  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob, { name: 'Bob Baker' })
  await expect(bobPage.getByRole('heading', { name: 'Invites for you' })).toBeVisible()
  await bobPage.getByRole('button', { name: `Accept and join Acme ${suffix}` }).click()
  await expect(bobPage).toHaveURL(new RegExp(`/a/${slug}$`))
  await expect(bobPage.getByTestId('my-role')).toHaveText('Writer')
  await expect(bobPage.locator('[data-action="write"]')).toHaveAttribute('data-allowed', 'true')
  await expect(bobPage.locator('[data-action="propose"]')).toHaveAttribute('data-allowed', 'true')
  await expect(bobPage.locator('[data-action="publish"]')).toHaveAttribute('data-allowed', 'false')
  await expect(bobPage.locator('[data-action="access"]')).toHaveAttribute('data-allowed', 'false')

  // A writer cannot manage access, through the UI or around it.
  await bobPage.goto(`/a/${slug}/members`)
  await expect(bobPage.getByRole('button', { name: 'Send invite' })).toHaveCount(0)
  const members = await (await bobPage.request.get(`/api/o/${slug}/members`)).json()
  const aliceId = members.members.find((member: { login: string }) => member.login === 'alice')
  expect(aliceId?.role).toBe('Owner')
  const refused = await bobPage.request.post(`/a/${slug}/members?/invite`, {
    form: { csrf: await csrfOf(bobPage), who: '@someone', role: 'admin' },
    headers: { origin: new URL(bobPage.url()).origin },
  })
  expect(refused.status()).toBe(403)

  // Alice sees Bob as a writer, and every change in the org's audit log, chain intact.
  await alice.reload()
  await expect(alice.locator(`tr[data-login="${bob}"] select`)).toHaveValue('writer')
  await alice.goto(`/a/${slug}/audit`)
  await expect(alice.getByTestId('chain')).toContainText('Chain verified')
  for (const action of ['org.provision', 'members.invite', 'members.invite.accept']) {
    await expect(alice.getByRole('cell', { name: action, exact: true }).first()).toBeVisible()
  }
  await expect(alice.getByRole('cell', { name: 'POST /a/[acct]/members?/invite' }).first()).toBeVisible()

  // Bob sees only his own entries.
  await bobPage.goto(`/a/${slug}/audit`)
  await expect(bobPage.getByTestId('chain')).toHaveCount(0)
  await expect(bobPage.getByRole('cell', { name: 'members.invite.accept', exact: true })).toBeVisible()
  await expect(bobPage.getByRole('cell', { name: 'members.invite', exact: true })).toHaveCount(0)
})

test('an admin manages access, removals and system accounts, and an org keeps an owner', async ({ browser }) => {
  const suffix = unique()
  const dana = `dana${suffix}`
  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'alice')
  const slug = await createOrg(owner, `Roles ${suffix}`)

  await owner.getByLabel('GitHub login or email').fill(dana)
  await owner.locator('form[action="?/invite"] select[name="role"]').selectOption('reader')
  await owner.getByRole('button', { name: 'Send invite' }).click()
  const danaPage = await (await browser.newContext()).newPage()
  await signIn(danaPage, dana)
  await danaPage.getByRole('button', { name: `Accept and join Roles ${suffix}` }).click()
  await expect(danaPage.getByTestId('my-role')).toHaveText('Reader on General')

  await owner.reload()
  const row = owner.locator(`tr[data-login="${dana}"]`)
  await row.locator('select').selectOption('admin')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(owner.getByText(`${dana} now has Admin on Roles ${suffix} (the whole account).`)).toBeVisible()

  // The new admin adds a system account in Settings › System accounts, but cannot touch the owner.
  await danaPage.goto(`/a/${slug}/members`)
  await expect(danaPage.locator('tr[data-login="alice"] [data-testid="role"]')).toHaveText('Owner')
  await expect(danaPage.locator('tr[data-login="alice"]').getByRole('button', { name: 'Remove @alice' })).toHaveCount(0)
  // Settings opens on the account's roles for anyone but an owner.
  await danaPage.goto(`/a/${slug}/settings`)
  await expect(danaPage).toHaveURL(new RegExp(`/a/${slug}/settings/roles$`))
  await danaPage.goto(`/a/${slug}/settings/system-accounts`)
  await danaPage.getByPlaceholder('github-sync').fill('ci-bot')
  await danaPage.getByRole('button', { name: 'Create system account' }).click()
  await expect(danaPage.getByText('Created ci-bot. Issue it a token below.')).toBeVisible()
  await danaPage.goto(`/a/${slug}/settings/system-accounts`)
  await expect(danaPage.locator('[data-service="ci-bot"]')).toContainText('Reader')

  const aliceRow = await (await danaPage.request.get(`/api/o/${slug}/members`)).json()
  expect(aliceRow.members.map((member: { login: string }) => member.login)).toContain('ci-bot')

  // Removed: the next request has no access, and answers 404 as if the org did not exist.
  await owner.reload()
  await owner.locator(`tr[data-login="${dana}"]`).getByRole('button', { name: `Remove @${dana}` }).click()
  await expect(owner.getByText('Member removed.')).toBeVisible()
  const gone = await danaPage.request.get(`/api/o/${slug}/members`)
  expect(gone.status()).toBe(404)
})
