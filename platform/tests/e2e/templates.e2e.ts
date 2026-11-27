// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

/**
 * New docket offers docket's `docket init --template` ontologies beside SDLC,
 * the lean catalogue and blank (§13.3), and a docket starts from each.
 */
const DOMAIN_TEMPLATES = [
  { id: 'people-org', name: 'People and organisations', type: 'organisation' },
  { id: 'crm', name: 'Customer relationships (CRM)', type: 'opportunity' },
  { id: 'research', name: 'Research and literature', type: 'paper' },
  { id: 'personal-knowledge', name: 'Personal knowledge', type: 'interest' },
  { id: 'product-catalogue', name: 'Product catalogue', type: 'variant' },
]

test('New docket offers every template, and a docket starts from each of docket’s domain templates', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, 'alice')
  const org = await createOrg(page, `Templates ${unique()}`)

  await page.goto(`/o/${org}/workspaces/new`)
  const picker = page.getByTestId('template-catalogue')
  for (const name of ['Software delivery (SDLC)', 'Lean service catalogue', ...DOMAIN_TEMPLATES.map((t) => t.name), 'Blank']) {
    await expect(picker.getByText(name, { exact: true })).toBeVisible()
  }

  for (const template of DOMAIN_TEMPLATES) {
    await page.goto(`/o/${org}/workspaces/new`)
    await page.getByLabel('Name').fill(template.id)
    await page.getByTestId('template-catalogue').getByText(template.name, { exact: true }).click()
    await page.getByRole('button', { name: 'Create docket' }).click()
    await expect(page).toHaveURL(new RegExp(`/o/${org}/w/${template.id}/ontology$`))
    await expect(page.getByTestId('ontology-status')).toContainText('v1 is published.')

    const exported = await page.request.get(`/o/${org}/w/${template.id}/ontology/export`)
    expect(exported.status()).toBe(200)
    expect(await exported.text()).toMatch(new RegExp(`^  ${template.type}:$`, 'm'))
    await page.goto(`/o/${org}/w/${template.id}/ontology/history`)
    await expect(page.getByText(`Started from the ${template.id} template`)).toBeVisible()
  }
})
