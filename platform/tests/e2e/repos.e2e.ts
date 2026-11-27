// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'workspace')
const ontology = readFileSync(join(FIXTURE, '.docket', 'entities.yaml'), 'utf8')
const files: Record<string, string> = Object.fromEntries(
  readdirSync(join(FIXTURE, '.docket'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return [relative(FIXTURE, path), readFileSync(path, 'utf8')]
    }),
)
const fakeGitHub = `http://127.0.0.1:${process.env.E2E_GITHUB_PORT ?? 4471}`
/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

async function fake(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`${fakeGitHub}${path}`, { data })
  expect(response.ok()).toBe(true)
  return response.json()
}

/**
 * G5's repo half (spec §1, §14): an admin installs the GitHub App, links the
 * installation to the org and connects a repo; its `.docket/` is imported, a
 * push shows up within a minute, and "Export cloud knowledge" opens a PR
 * against the repo containing docket-format Markdown.
 */
test('a push to a connected repo is synced, and an export opens a PR against it', async ({ page, request }) => {
  test.skip(!WORKER, 'needs the worker and its stores')
  test.setTimeout(120_000)
  const owner = `alice`
  const repo = `${owner}/platform-${unique()}`
  await fake(request, '/_fake/repos', { fullName: repo, files: { ...files, '.docket.yaml': 'version: 2\nadapters: []\n' } })
  await fake(request, '/_fake/installations', { account: owner, repos: [repo], users: [owner] })

  await signIn(page, owner)
  const slug = await createOrg(page, `Repos ${unique()}`)
  await page.goto(`/o/${slug}/workspaces/new`)
  await page.getByLabel('Name').fill('Platform')
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: Buffer.from(ontology) })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page.getByTestId('ontology-status')).toContainText('v1 is published')
  const ws = `/o/${slug}/w/platform`

  // Install on GitHub, come back through the setup URL, and prove the account through GitHub sign-in.
  await page.goto(`${ws}/repos`)
  await page.getByRole('link', { name: 'Install the GitHub App on your repos' }).click()
  await page.getByRole('link', { name: `Install on ${owner}` }).click()
  await page.getByLabel('Login').fill(owner)
  await page.getByRole('button', { name: 'Authorize' }).click()
  await expect(page.getByRole('status')).toContainText(`GitHub account ${owner} is linked to this organisation`)

  // Connect: the first import brings in the 12 documents.
  await page.getByRole('combobox', { name: 'Repo' }).selectOption({ label: `${repo} (private)` })
  await page.getByRole('button', { name: 'Connect and import' }).click()
  await expect(page.getByText(`Connected ${repo}@main. The first import runs now.`)).toBeVisible()
  const card = page.locator(`article[data-repo="${repo}"]`)
  await expect(card.getByTestId('sync-state')).toHaveText('in sync', { timeout: 30_000 })
  await expect(card.getByText('Files').locator('..')).toContainText('12')
  await page.goto(`${ws}/documents`)
  await expect(page.locator('tr[data-resource]')).toHaveCount(12)

  // A push lands within a minute (the debounce here is 1 s, 10 s in production).
  const pushed: { sha: string; delivery: { status: number } } = await fake(request, `/_fake/repos/${repo}/push`, {
    files: { '.docket/resources/service/billing.md': '---\nid: service.billing\ntype: service\ntitle: Billing\n---\nSends the invoices.\n' },
    message: 'Add billing',
  })
  expect(pushed.delivery.status).toBe(202)
  await expect(async () => {
    await page.goto(`${ws}/documents`)
    await expect(page.locator('tr[data-resource="service.billing"]')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 60_000 })
  await expect(page.locator('tr[data-resource="service.billing"]')).toContainText('repo')
  await page.goto(`${ws}/repos`)
  await expect(page.locator(`tr[data-commit="${pushed.sha}"]`)).toContainText('+1 written')

  // Knowledge written in the cloud goes back as a PR.
  await page.goto(`${ws}/documents`)
  await page.locator('input[name="files"]').setInputFiles({
    name: 'ledger.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('---\nid: service.ledger\ntype: service\ntitle: Ledger\n---\nKeeps the books.\n'),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 1 document.')).toBeVisible()
  await page.goto(`${ws}/repos`)
  await card.getByLabel('Export PRs').check()
  await expect(page.getByText(`Export PRs are on for ${repo}.`)).toBeVisible()
  await card.getByRole('button', { name: 'Export cloud knowledge' }).click()
  await expect(page.getByText(`Export queued: a PR against ${repo}@main opens shortly.`)).toBeVisible()
  await expect(card.getByTestId('last-export')).toHaveText('#1', { timeout: 30_000 })

  const state = await (await request.get(`${fakeGitHub}/_fake/repos/${repo}?branch=${encodeURIComponent((await (await request.get(`${fakeGitHub}/_fake/repos/${repo}`)).json()).pulls[0].head)}`)).json()
  expect(state.pulls[0]).toMatchObject({ base: 'main', state: 'open' })
  expect(state.pulls[0].head).toMatch(/^docket-cloud\/export-\d{8}-\d{4}$/)
  expect(state.pulls[0].body).toContain('`service.ledger`')
  expect(state.files['.docket/resources/service/ledger.md']).toBe('---\nid: service.ledger\ntype: service\ntitle: Ledger\n---\nKeeps the books.\n')
})

test('a delivery with a bad signature is refused with 401', async ({ request }) => {
  const response = await request.post('/api/github/webhook', {
    headers: { 'x-github-event': 'push', 'x-github-delivery': '1', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
    data: { ref: 'refs/heads/main' },
  })
  expect(response.status()).toBe(401)
})
