// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import pg from 'pg'

/** A short random suffix, so each test's logins and orgs are its own. */
export const unique = () => randomBytes(3).toString('hex')

/** Signs in through the fake GitHub as `login`. */
export async function signIn(page: Page, login: string, options: { name?: string; email?: string } = {}) {
  await page.goto('/signin')
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await expect(page.getByRole('heading', { name: 'Fake GitHub' })).toBeVisible()
  await page.getByLabel('Login').fill(login)
  if (options.name) await page.getByLabel('Name').fill(options.name)
  if (options.email) await page.getByLabel('Email').fill(options.email)
  await page.getByRole('button', { name: 'Authorize' }).click()
}

/** Creates an org from the home page and returns its slug. */
export async function createOrg(page: Page, name: string): Promise<string> {
  await page.goto('/orgs/new')
  await page.getByLabel('Name').fill(name)
  const slug = await page.getByLabel('Address').inputValue()
  await page.getByRole('button', { name: 'Create organisation' }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/members$`))
  return slug
}

/** The session's CSRF token, as the page's forms carry it. */
export async function csrfOf(page: Page): Promise<string> {
  const token = await page.locator('input[name="csrf"]').first().inputValue()
  expect(token).not.toBe('')
  return token
}

/** A connection as the app's request role: what a routing bug would run with. */
export function requestRole(): pg.Client {
  const base = new URL(process.env.DOCKET_TEST_PG_URL ?? '')
  const db = process.env.E2E_DB ?? 'docket_e2e'
  base.pathname = `/${db}`
  base.username = `${db}_app`
  base.password = `${db}-local-only`
  return new pg.Client({ connectionString: base.toString() })
}

/** docket's worked example, `examples/acme-platform`: 21 resources and 37 links. */
const ACME = join(import.meta.dirname, '..', 'fixtures', 'acme-platform')

/** Creates a workspace named `name` from the acme-platform example: its ontology, then its 21 documents. Returns its slug. */
export async function acmeWorkspace(page: Page, org: string, name = 'Acme'): Promise<string> {
  const ws = name.toLowerCase()
  const ontology = readFileSync(join(ACME, '.docket', 'entities.yaml'))
  const documents = readdirSync(join(ACME, '.docket'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { name: relative(ACME, path).replace(/\//g, '_'), mimeType: 'text/markdown', buffer: readFileSync(path) }
    })
  await page.goto(`/o/${org}/workspaces/new`)
  await page.getByLabel('Name').fill(name)
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({ name: 'entities.yaml', mimeType: 'text/yaml', buffer: ontology })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${org}/w/${ws}/ontology$`))
  await page.goto(`/o/${org}/w/${ws}/documents`)
  await page.locator('input[name="files"]').setInputFiles(documents)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 21 documents.')).toBeVisible()
  return ws
}

/**
 * Creates a personal token for one docket on its MCP page and returns its
 * text, which the page shows once. A token acts as its owner; `scopes` that
 * write nothing make it read-only.
 */
export async function createToken(page: Page, org: string, ws: string, options: { scopes?: string[]; description?: string } = {}): Promise<string> {
  await page.goto(`/o/${org}/w/${ws}/mcp`)
  await page.getByLabel('Name', { exact: true }).fill(options.description ?? 'e2e')
  const writes = (options.scopes ?? ['docket:read']).some((scope) => scope !== 'docket:read' && scope !== 'ontology:read')
  const readOnly = page.getByRole('checkbox', { name: /Read-only/ })
  if (await readOnly.isEnabled()) await readOnly.setChecked(!writes)
  await page.getByRole('button', { name: 'Create token' }).click()
  const token = await page.getByTestId('token-value').innerText()
  expect(token).toMatch(/^dkt_pat_[0-9A-Za-z]{43}_[0-9a-f]{8}$/)
  return token
}

/** One JSON-RPC call to a workspace's MCP endpoint with a bearer token. */
export async function mcp(request: APIRequestContext, path: string, token: string, method: string, params: Record<string, unknown> = {}) {
  return request.post(path, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })
}
