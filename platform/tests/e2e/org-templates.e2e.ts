// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, csrfOf, signIn, unique } from './helpers'

/**
 * The org's own templates: an owner saves a docket's ontology as one, New
 * docket's catalogue offers it beside the built-in ones (searchable and
 * filtered), it is renamed and deleted from the templates page, and only
 * owners and admins manage them. Describing the domain says plainly when AI
 * cannot draft (the suite runs with AI off).
 */
test('a docket saved as a template is offered by New docket, managed by owners and admins only', async ({ browser }) => {
  test.setTimeout(120_000)
  const suffix = unique()
  const bobLogin = `bob${suffix}`
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  const org = await createOrg(alice, `Templates org ${suffix}`)

  // The catalogue: search, the built-in filter and the domain tags narrow the cards.
  await alice.goto(`/a/${org}/dockets/new`)
  const catalogue = alice.getByTestId('template-catalogue')
  await expect(catalogue.getByText('Customer relationships (CRM)', { exact: true })).toBeVisible()
  await expect(alice.getByRole('button', { name: /^Your account/ })).toBeDisabled()
  await alice.getByPlaceholder('Search by name, record type or domain').fill('opportunity')
  await expect(catalogue.getByText('Customer relationships (CRM)', { exact: true })).toBeVisible()
  await expect(catalogue.getByText('Research and literature', { exact: true })).toHaveCount(0)
  await alice.getByPlaceholder('Search by name, record type or domain').fill('')
  await alice.getByRole('button', { name: 'research', exact: true }).click()
  await expect(catalogue.getByText('Research and literature', { exact: true })).toBeVisible()
  await expect(catalogue.getByText('Customer relationships (CRM)', { exact: true })).toHaveCount(0)
  await alice.getByPlaceholder('Search by name, record type or domain').fill('nothing matches this')
  await expect(alice.getByText('No template matches.')).toBeVisible()
  await alice.getByRole('button', { name: 'Show every template' }).click()

  // Start a CRM docket, and save it as a template from its settings.
  await alice.getByLabel('Name').fill('Sales')
  await catalogue.getByText('Customer relationships (CRM)', { exact: true }).click()
  await alice.getByRole('button', { name: 'Create docket' }).click()
  await expect(alice).toHaveURL(new RegExp(`/a/${org}/d/sales/ontology$`))
  await alice.goto(`/a/${org}/d/sales/settings`)
  const save = alice.getByTestId('save-template')
  await save.getByLabel('Name').fill('Field sales')
  await save.getByLabel('Domain tags').fill('Sales, field')
  await save.getByLabel('Description').fill('Deals and the reps who own them.')
  await save.getByRole('button', { name: 'Save as a template' }).click()
  await expect(alice.getByText('Saved as the "Field sales" template.')).toBeVisible()

  // New docket offers it under "Your organisation", with what it holds, and a docket starts from it.
  await alice.goto(`/a/${org}/dockets/new`)
  await alice.getByRole('button', { name: /^Your account/ }).click()
  const card = catalogue.locator('label', { hasText: 'Field sales' })
  await expect(card).toContainText('Your account')
  await expect(card).toContainText('Deals and the reps who own them.')
  await expect(card).toContainText('account')
  await expect(catalogue.getByText('Customer relationships (CRM)', { exact: true })).toHaveCount(0)
  await alice.getByLabel('Name').fill('East sales')
  await card.click()
  await alice.getByRole('button', { name: 'Create docket' }).click()
  await expect(alice).toHaveURL(new RegExp(`/a/${org}/d/east-sales/ontology$`))
  await alice.goto(`/a/${org}/d/east-sales/ontology/history`)
  await expect(alice.getByText('Started from the Field sales template')).toBeVisible()

  // The templates page renames it and deletes it; built-in templates are read-only there.
  await alice.goto(`/a/${org}/templates`)
  await expect(alice.getByText('Software delivery (SDLC)', { exact: true })).toBeVisible()
  const managed = alice.getByTestId('org-template')
  await expect(managed).toHaveCount(1)
  await managed.getByText('Edit').click()
  await managed.getByLabel('Name').fill('Enterprise sales')
  await managed.getByRole('button', { name: 'Save changes' }).click()
  await expect(alice.getByText('Saved "Enterprise sales".')).toBeVisible()

  // An editor reaches none of it: no templates page, no save in settings, no action.
  await alice.goto(`/a/${org}/members`)
  await alice.getByLabel('GitHub login or email').fill(`@${bobLogin}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('writer')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  const bob = await (await browser.newContext()).newPage()
  await signIn(bob, bobLogin)
  await bob.getByRole('button', { name: /^Accept and join/ }).click()
  await expect(bob.getByTestId('my-role')).toHaveText('Writer on General')
  expect((await bob.request.get(`/a/${org}/templates`)).status()).toBe(403)
  await bob.goto(`/a/${org}/d/sales/settings`)
  await expect(bob.getByTestId('save-template')).toHaveCount(0)
  const refused = await bob.request.post(`/a/${org}/d/sales/settings?/saveTemplate`, {
    form: { csrf: await csrfOf(bob), name: 'Sneaky' },
    headers: { origin: new URL(bob.url()).origin, 'x-sveltekit-action': 'true' },
  })
  expect(await refused.text()).not.toContain('Saved as the')
  expect((await bob.request.get(`/a/${org}/dockets/new`)).status()).toBe(403)

  // Deleting it leaves the docket started from it as it was.
  await alice.goto(`/a/${org}/templates`)
  alice.once('dialog', (dialog) => void dialog.accept())
  await managed.getByText('Edit').click()
  await managed.getByRole('button', { name: 'Delete template' }).click()
  await expect(alice.getByText('Deleted "Enterprise sales".')).toBeVisible()
  await expect(managed).toHaveCount(0)
  expect((await alice.request.get(`/a/${org}/d/east-sales/ontology/export`)).status()).toBe(200)
})

test("another org never sees an org's templates", async ({ browser }) => {
  const suffix = unique()
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  const orgA = await createOrg(alice, `Template owner ${suffix}`)
  await alice.goto(`/a/${orgA}/dockets/new`)
  await alice.getByLabel('Name').fill('Private')
  await alice.getByRole('button', { name: 'Create docket' }).click()
  await expect(alice).toHaveURL(new RegExp(`/a/${orgA}/d/private/ontology$`))
  await alice.goto(`/a/${orgA}/d/private/settings`)
  await alice.getByTestId('save-template').getByLabel('Name').fill(`Secret template ${suffix}`)
  await alice.getByTestId('save-template').getByRole('button', { name: 'Save as a template' }).click()
  await expect(alice.getByText(`Saved as the "Secret template ${suffix}" template.`)).toBeVisible()

  const carol = await (await browser.newContext()).newPage()
  await signIn(carol, 'carol')
  const orgB = await createOrg(carol, `Template neighbour ${suffix}`)
  await carol.goto(`/a/${orgB}/dockets/new`)
  await expect(carol.getByTestId('template-catalogue')).not.toContainText(`Secret template ${suffix}`)
  await carol.goto(`/a/${orgB}/templates`)
  await expect(carol.getByText(`Secret template ${suffix}`)).toHaveCount(0)
  expect((await carol.request.get(`/a/${orgA}/templates`)).status()).toBe(404)
})

test('describing the domain says plainly when AI cannot draft, and creates nothing', async ({ page }) => {
  await signIn(page, 'alice')
  const org = await createOrg(page, `Describe ${unique()}`)
  await page.goto(`/a/${org}/dockets/new`)
  await page.getByLabel('Name').fill('Vets')
  await page.getByText('Describe your domain').click()
  await page.getByRole('button', { name: 'Draft with AI' }).click()
  await expect(page.getByRole('alert')).toContainText('Describe what the docket should keep track of.')
  await page.getByLabel('What should this docket keep track of?').fill('Pets, their owners, appointments and treatments at our vet clinic.')
  await page.getByRole('button', { name: 'Draft with AI' }).click()
  await expect(page.getByRole('alert')).toContainText('AI is not set up for this account yet')
  await expect(page.getByLabel('What should this docket keep track of?')).toHaveValue('Pets, their owners, appointments and treatments at our vet clinic.')
  expect((await page.request.get(`/a/${org}/d/vets/ontology`)).status()).toBe(404)
  // Another member's draft, or one that never was, is not found.
  expect((await page.request.get(`/a/${org}/dockets/new/draft/00000000-0000-0000-0000-000000000000`)).status()).toBe(404)
})
