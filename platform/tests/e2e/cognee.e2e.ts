// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'

import { acmeWorkspace, createOrg, signIn, unique } from './helpers'

test('cognee is off by default, and where no cognee service runs Settings says so and Sync shows only the fixed stores', async ({ page }) => {
  await signIn(page, 'alice')
  const org = await createOrg(page, `Cognee ${unique()}`)
  const ws = await acmeWorkspace(page, org)

  await page.goto(`/a/${org}/d/${ws}/settings`)
  const section = page.getByTestId('cognee')
  await expect(section.getByTestId('cognee-status')).toHaveText('Off')
  await expect(section.getByTestId('cognee-unavailable')).toHaveText('cognee does not run on this server.')
  await expect(section.getByLabel('Project this docket into cognee')).toBeDisabled()
  await expect(section.getByLabel(/Search floor/)).toHaveValue('0.58')

  // Its floor and limit save while it stays off.
  await section.getByLabel(/Search floor/).fill('0.6')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('status')).toContainText('Off: search no longer asks cognee')
  await expect(section.getByLabel(/Search floor/)).toHaveValue('0.6')

  await page.goto(`/a/${org}/d/${ws}/settings/sync`)
  await expect(page.getByTestId('store-neo4j')).toBeVisible()
  await expect(page.getByTestId('store-mem0')).toBeVisible()
  await expect(page.getByTestId('store-cognee')).toHaveCount(0)
})
