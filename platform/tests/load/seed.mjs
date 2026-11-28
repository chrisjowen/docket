// SPDX-License-Identifier: AGPL-3.0-only
// Seeds a local build for the load test (mcp-search.k6.js): 4 orgs, each with
// docket's acme-platform example as its Acme workspace and 5 API tokens with
// docket:read, signed in through the fake GitHub that tests/e2e/serve.mjs
// starts. Writes the k6 targets file, readable only by you; keep it out of the repo.
//
//   node tests/load/seed.mjs http://127.0.0.1:4470 /tmp/docket-load-targets.json
//   k6 run tests/load/mcp-search.k6.js -e BASE_URL=http://127.0.0.1:4470 -e TARGETS_FILE=/tmp/docket-load-targets.json
//
// Environment: LOAD_ORGS (default 4), LOAD_TOKENS_PER_ORG (default 5), LOAD_LOGIN (default alice, on
// serve.mjs's allowlist). serve.mjs allows 20 orgs, so a database holds about four seedings; start it
// afresh for more.
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const [base = 'http://127.0.0.1:4470', out] = process.argv.slice(2)
if (!out) {
  console.error('seed: node tests/load/seed.mjs <base url> <targets file>')
  process.exit(1)
}
const orgs = Number(process.env.LOAD_ORGS ?? 4)
const perOrg = Number(process.env.LOAD_TOKENS_PER_ORG ?? 5)
const login = process.env.LOAD_LOGIN ?? 'alice'

const acme = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acme-platform')
const ontology = readFileSync(join(acme, '.docket', 'entities.yaml'))
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
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await page.getByLabel('Login').fill(login)
  await page.getByRole('button', { name: 'Authorize' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/signin') && url.origin === new URL(base).origin)

  const run = randomBytes(2).toString('hex')
  const targets = []
  for (let n = 1; n <= orgs; n += 1) {
    const org = `load-${run}-${n}`
    await page.goto(`${base}/orgs/new`)
    await page.getByLabel('Name').fill(`Load ${run} ${n}`)
    await page.getByLabel('Address').fill(org)
    await page.getByRole('button', { name: 'Create organisation' }).click()
    await page.waitForURL(new RegExp(`/a/${org}/members$`))

    await page.goto(`${base}/a/${org}/dockets/new`)
    await page.getByLabel('Name').fill('Acme')
    await page.getByText('An entities.yaml file').click()
    await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: ontology })
    await page.getByRole('button', { name: 'Create docket' }).click()
    await page.waitForURL(/\/ontology$/)
    await page.goto(`${base}/a/${org}/d/acme/documents`)
    await page.locator('input[name="files"]').setInputFiles(documents)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.getByText(`Wrote ${documents.length} documents.`).waitFor()

    for (let t = 1; t <= perOrg; t += 1) {
      await page.goto(`${base}/a/${org}/d/acme/mcp`)
      await page.getByLabel('Description').fill(`load test ${t}`)
      for (const box of await page.locator('input[name="scope"]:not([disabled])').all()) {
        if ((await box.getAttribute('value')) === 'docket:read') await box.check()
        else await box.uncheck()
      }
      await page.getByRole('button', { name: 'Create token' }).click()
      targets.push({ org, ws: 'acme', token: await page.getByTestId('token-value').innerText() })
    }

    // Searches answer from the projections: wait until the worker has indexed the workspace.
    await page.goto(`${base}/a/${org}/d/acme/graph`)
    await page.getByText('Index up to date').waitFor({ timeout: 120_000 })
    console.log(`seed: ${org}/acme with ${perOrg} tokens`)
  }
  writeFileSync(out, JSON.stringify(targets), { mode: 0o600 })
  console.log(`seed: wrote ${targets.length} targets to ${out}`)
} finally {
  await browser.close()
}
