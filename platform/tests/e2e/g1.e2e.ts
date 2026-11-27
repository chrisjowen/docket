// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, csrfOf, signIn, unique } from './helpers'

/**
 * G1 (spec §1): an invited user signs in with GitHub, creates an org, invites
 * a second user as editor, and the second user can write but not publish the
 * ontology.
 */
test('G1: create an org, invite an editor who can write but not publish', async ({ browser }) => {
  const suffix = unique()
  const bob = `bob${suffix}`

  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice', { name: 'Alice Archer' })
  const slug = await createOrg(alice, `Acme ${suffix}`)
  await expect(alice.getByRole('heading', { name: 'Members & roles' })).toBeVisible()
  await expect(alice.locator(`tr[data-login="alice"] [data-testid="role"]`)).toHaveText('owner')

  await alice.getByLabel('GitHub login or email').fill(`@${bob}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('editor')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  await expect(alice.getByText(`Invited @${bob} as editor.`)).toBeVisible()
  await expect(alice.getByText(`@${bob}`, { exact: true })).toBeVisible()

  // Bob is not on the beta list; the pending invite admits him.
  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob, { name: 'Bob Baker' })
  await expect(bobPage.getByRole('heading', { name: 'Invites for you' })).toBeVisible()
  await bobPage.getByRole('button', { name: `Accept and join Acme ${suffix}` }).click()
  await expect(bobPage).toHaveURL(new RegExp(`/o/${slug}$`))
  await expect(bobPage.getByTestId('my-role')).toHaveText('editor')
  await expect(bobPage.locator('[data-action="knowledge.write"]')).toHaveAttribute('data-allowed', 'true')
  await expect(bobPage.locator('[data-action="ontology.propose"]')).toHaveAttribute('data-allowed', 'true')
  await expect(bobPage.locator('[data-action="ontology.publish"]')).toHaveAttribute('data-allowed', 'false')
  await expect(bobPage.locator('[data-action="members.manage"]')).toHaveAttribute('data-allowed', 'false')

  // An editor cannot manage members, through the UI or around it.
  await bobPage.goto(`/o/${slug}/members`)
  await expect(bobPage.getByRole('button', { name: 'Send invite' })).toHaveCount(0)
  const members = await (await bobPage.request.get(`/api/o/${slug}/members`)).json()
  const aliceId = members.members.find((member: { login: string }) => member.login === 'alice')
  expect(aliceId?.role).toBe('owner')
  const refused = await bobPage.request.post(`/o/${slug}/members?/invite`, {
    form: { csrf: await csrfOf(bobPage), who: '@someone', role: 'admin' },
    headers: { origin: new URL(bobPage.url()).origin },
  })
  expect(refused.status()).toBe(403)

  // Alice sees Bob as an editor, and every change in the org's audit log, chain intact.
  await alice.reload()
  await expect(alice.locator(`tr[data-login="${bob}"] select`)).toHaveValue('editor')
  await alice.goto(`/o/${slug}/audit`)
  await expect(alice.getByTestId('chain')).toContainText('Chain verified')
  for (const action of ['org.provision', 'members.invite', 'members.invite.accept']) {
    await expect(alice.getByRole('cell', { name: action, exact: true }).first()).toBeVisible()
  }
  await expect(alice.getByRole('cell', { name: 'POST /o/[org]/members?/invite' }).first()).toBeVisible()

  // Bob sees only his own entries.
  await bobPage.goto(`/o/${slug}/audit`)
  await expect(bobPage.getByTestId('chain')).toHaveCount(0)
  await expect(bobPage.getByRole('cell', { name: 'members.invite.accept', exact: true })).toBeVisible()
  await expect(bobPage.getByRole('cell', { name: 'members.invite', exact: true })).toHaveCount(0)
})

test('an admin manages roles, removals and service accounts, and an org keeps an owner', async ({ browser }) => {
  const suffix = unique()
  const dana = `dana${suffix}`
  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'alice')
  const slug = await createOrg(owner, `Roles ${suffix}`)

  await owner.getByLabel('GitHub login or email').fill(dana)
  await owner.locator('form[action="?/invite"] select[name="role"]').selectOption('viewer')
  await owner.getByRole('button', { name: 'Send invite' }).click()
  const danaPage = await (await browser.newContext()).newPage()
  await signIn(danaPage, dana)
  await danaPage.getByRole('button', { name: `Accept and join Roles ${suffix}` }).click()
  await expect(danaPage.getByTestId('my-role')).toHaveText('viewer')

  await owner.reload()
  const row = owner.locator(`tr[data-login="${dana}"]`)
  await row.locator('select').selectOption('admin')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(owner.getByText('Role changed from viewer to admin.')).toBeVisible()

  // The new admin adds a service account, but cannot touch the owner.
  await danaPage.goto(`/o/${slug}/members`)
  await expect(danaPage.locator('tr[data-login="alice"] [data-testid="role"]')).toHaveText('owner')
  await danaPage.getByPlaceholder('ci-bot').fill('ci-bot')
  await danaPage.getByRole('button', { name: 'Add service account' }).click()
  await expect(danaPage.getByText('Service account ci-bot added.')).toBeVisible()
  await expect(danaPage.locator('[data-service="ci-bot"]')).toContainText('viewer')

  const aliceRow = await (await danaPage.request.get(`/api/o/${slug}/members`)).json()
  expect(aliceRow.members.map((member: { login: string }) => member.login)).toContain('ci-bot')

  // Removed: the next request has no access, and answers 404 as if the org did not exist.
  await owner.reload()
  await owner.locator(`tr[data-login="${dana}"]`).getByRole('button', { name: `Remove @${dana}` }).click()
  await expect(owner.getByText('Member removed.')).toBeVisible()
  const gone = await danaPage.request.get(`/api/o/${slug}/members`)
  expect(gone.status()).toBe(404)
})
