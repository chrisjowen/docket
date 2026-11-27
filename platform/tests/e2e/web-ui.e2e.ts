// SPDX-License-Identifier: AGPL-3.0-only
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { acmeWorkspace, createOrg, signIn, unique } from './helpers'

/**
 * The web UI (packages/docket-ui/cloud): a static single-page app that calls
 * the public API alone. The server bundles it and answers its pages - a
 * docket's Access tab first - beside the pages it still renders; the same
 * build also runs on its own host (standalone.mjs) in front of the server,
 * passing /api and the rest through.
 */

const STANDALONE_PORT = Number(process.env.E2E_PORT ?? 4470) + 30
const ROOT = join(import.meta.dirname, '..', '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'platform', 'apps', 'server', 'ui', 'site', '_ui', 'manifest.json'), 'utf8')) as { version: string; api: string; routes: string[] }

let alice: Page
let org: string
let standalone: ChildProcess | null = null
const bob = `bob${unique()}`

test.beforeAll(async ({ browser }) => {
  alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  org = await createOrg(alice, `Web UI ${unique()}`)
  await acmeWorkspace(alice, org)
  // Bob joins, so there is someone to give access to.
  await alice.goto(`/o/${org}/members`)
  await alice.getByLabel('GitHub login or email').fill(`@${bob}`)
  await alice.locator('form[action="?/invite"] select[name="role"]').selectOption('reader')
  await alice.getByRole('button', { name: 'Send invite' }).click()
  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob)
  await bobPage.getByRole('button', { name: /^Accept and join/ }).click()
  await bobPage.context().close()
})

test.afterAll(async () => {
  standalone?.kill('SIGTERM')
  await alice?.context().close()
})

/** Gives Bob Writer on the docket from its Access tab, and takes it away again, all through the API. */
async function giveAndTakeBack(page: Page) {
  const form = page.getByTestId('give-access')
  const bobId = await form.locator('select[name="who"] option', { hasText: bob }).getAttribute('value')
  await form.locator('select[name="who"]').selectOption(bobId ?? '')
  await form.getByTestId('role-select').selectOption('writer')
  await form.getByRole('button', { name: 'Give access' }).click()
  await expect(page.getByRole('status')).toContainText(`${bob} now has Writer on Acme (docket)`)
  const row = page.getByRole('list', { name: 'Grants on this docket' }).locator(`li[data-who="${bob}"]`)
  await expect(row).toContainText('Writer')
  await row.getByRole('button', { name: /^Remove / }).click()
  await expect(page.getByRole('status')).toContainText(`${bob} no longer has Writer`)
  await expect(row).toHaveCount(0)
}

test('the server serves the web UI for its pages, and the Access tab works through the API', async () => {
  // The page is the web UI's: its files under /_ui/, and nothing rendered on the server.
  const page = await alice.request.get(`/o/${org}/w/acme/access`)
  expect(page.status()).toBe(200)
  expect(await page.text()).toContain('/_ui/immutable/')
  expect(manifest.routes).toContain('/o/[org]/w/[ws]/access')
  expect((await alice.request.get('/_ui/manifest.json')).status()).toBe(200)
  expect((await alice.request.post(`/o/${org}/w/acme/access`, { data: {} })).status()).toBe(405)

  const calls: string[] = []
  alice.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) calls.push(`${request.method()} ${path.replace(/\/grants\/[^/]+$/, '/grants/*')}`)
  })
  await alice.goto(`/o/${org}/w/acme/access`)
  await expect(alice.getByRole('heading', { name: 'Access', level: 1 })).toBeVisible()
  await expect(alice.getByTestId('your-access')).toContainText('Owner')
  // The shell and the docket's frame are the server's own, filled from the API.
  await expect(alice.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Access' })).toHaveAttribute('aria-current', 'page')
  await expect(alice.getByRole('navigation', { name: 'Sidebar' })).toContainText('Acme')
  await giveAndTakeBack(alice)
  expect(calls).toEqual(
    expect.arrayContaining([
      'GET /api/v1/me',
      `GET /api/v1/accounts/${org}/navigation`,
      `GET /api/v1/accounts/${org}/dockets/acme`,
      `GET /api/v1/accounts/${org}/dockets/acme/summary`,
      `GET /api/v1/accounts/${org}/access`,
      `GET /api/v1/accounts/${org}/access/who`,
      `GET /api/v1/accounts/${org}/grants`,
      `GET /api/v1/accounts/${org}/roles`,
      `POST /api/v1/accounts/${org}/grants`,
      `DELETE /api/v1/accounts/${org}/grants/${'*'}`,
    ]),
  )
  expect(calls.every((call) => call.includes('/api/v1'))).toBe(true)

  // Its links to the pages the server still renders lead there.
  await alice.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Overview' }).click()
  await expect(alice).toHaveURL(`/o/${org}/w/acme/overview`)
})

test('the Access tab works on a phone', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await alice.context().storageState() })
  const page = await phone.newPage()
  await page.goto(`/o/${org}/w/acme/access`)
  await expect(page.getByTestId('your-access')).toContainText('Owner')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await giveAndTakeBack(page)
  await phone.close()
})

test('the same build runs on its own host, passing /api through to the server', async ({ baseURL, browser }) => {
  const api = new URL(baseURL ?? 'http://127.0.0.1:4470')
  standalone = spawn(process.execPath, [join(ROOT, 'packages', 'docket-ui', 'cloud', 'standalone.mjs'), '--api', api.origin, '--port', String(STANDALONE_PORT), '--site', join(ROOT, 'platform', 'apps', 'server', 'ui', 'site')], { stdio: 'pipe' })
  const host = `http://127.0.0.1:${STANDALONE_PORT}`
  await expect.poll(async () => (await fetch(`${host}/_ui/manifest.json`).catch(() => null))?.status ?? 0, { timeout: 15_000 }).toBe(200)
  // It checks the server's API version before it serves.
  const check = spawn(process.execPath, [join(ROOT, 'packages', 'docket-ui', 'cloud', 'standalone.mjs'), '--api', api.origin, '--check', '--site', join(ROOT, 'platform', 'apps', 'server', 'ui', 'site')])
  expect(await new Promise((done) => check.on('exit', done))).toBe(0)

  // The session cookie is the host's (cookies keep to a host, whatever its port), so the signed-in browser is
  // signed in here too; every API call goes through this host.
  const context = await browser.newContext({ storageState: await alice.context().storageState() })
  const page = await context.newPage()
  await page.goto(`${host}/o/${org}/w/acme/access`)
  await expect(page.getByTestId('your-access')).toContainText('Owner')
  await giveAndTakeBack(page)
  expect((await fetch(`${host}/api/v1/openapi.json`)).status).toBe(200)
  await context.close()
})
