// SPDX-License-Identifier: AGPL-3.0-only
// Seeds a local preview for its demo user: the Acme Corp organisation, owned
// by the demo user, with docket's acme-platform example as its Platform
// workspace, so the graph browser has something to show. Safe to repeat.
//
//   E2E_DEMO_LOGIN=alice node tests/e2e/seed-demo.mjs http://localhost:4480
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:4480'
const login = (process.env.E2E_DEMO_LOGIN ?? '').trim().toLowerCase()
if (!login) {
  console.error('seed-demo: set E2E_DEMO_LOGIN=<login>, as serve.mjs was started with')
  process.exit(1)
}
const acme = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acme-platform')
const documents = readdirSync(join(acme, '.docket'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => {
    const path = join(entry.parentPath, entry.name)
    return { name: relative(acme, path).replace(/\//g, '_'), mimeType: 'text/markdown', buffer: readFileSync(path) }
  })

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${base}/signin`)
  await page.getByTestId('demo-signin').getByRole('button', { name: `Sign in as demo user (${login})` }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'))

  const org = 'acme-corp'
  const graph = `${base}/o/${org}/w/platform/graph`
  if ((await page.goto(graph))?.status() === 200) {
    console.log(`seed-demo: already seeded: ${graph}`)
  } else {
    await page.goto(`${base}/orgs/new`)
    await page.getByLabel('Name').fill('Acme Corp')
    await page.getByLabel('Address').fill(org)
    await page.getByRole('button', { name: 'Create organisation' }).click()
    await page.waitForURL(new RegExp(`/o/${org}/members$`))
    await page.goto(`${base}/o/${org}/workspaces/new`)
    await page.getByLabel('Name').fill('Platform')
    await page.getByText('An entities.yaml file').click()
    await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({
      name: 'entities.yaml',
      mimeType: 'text/yaml',
      buffer: readFileSync(join(acme, '.docket', 'entities.yaml')),
    })
    await page.getByRole('button', { name: 'Create docket' }).click()
    await page.waitForURL(/\/ontology$/)
    await page.goto(`${base}/o/${org}/w/platform/documents`)
    await page.locator('input[name="files"]').setInputFiles(documents)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.getByText(`Wrote ${documents.length} documents.`).waitFor()
    console.log(`seed-demo: seeded ${graph}`)
  }
} finally {
  await browser.close()
}
