// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'
import pg from 'pg'

import { acmeWorkspace, createOrg, createToken, csrfOf, mcp, signIn, unique } from './helpers'

/**
 * A workspace's documents, opened one by one, and deleting a workspace (§4):
 * an owner or admin types its slug to confirm; its documents, ontology,
 * tokens, repo connections and projections go, the audit log keeps the event,
 * and nobody else can.
 */

/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

/** Runs `fn` on the e2e database as Postgres' superuser. */
async function superuser<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DOCKET_TEST_PG_URL ?? '')
  url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function orgSchema(client: pg.Client, slug: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM platform.orgs WHERE slug = $1', [slug])
  const schema = `org_${rows[0]?.id ?? ''}`
  if (!/^org_[a-z0-9]{1,40}$/.test(schema)) throw new Error('no such org')
  return schema
}

test('documents open from the workspace in one click: frontmatter, body and every revision', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const org = await createOrg(page, `Docs ${unique()}`)
  await acmeWorkspace(page, org)

  await page.goto(`/o/${org}/w/acme/graph`)
  await expect(page.getByTestId('documents')).toHaveText('21 documents')
  await page.getByTestId('documents').click()
  await expect(page).toHaveURL(new RegExp(`/o/${org}/w/acme/documents$`))
  await page.getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${org}/w/acme/documents/\\.docket/resources/service/orders\\.md$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible()
  await expect(page.getByTestId('document-frontmatter')).toContainText('id: service.orders')
  await expect(page.getByTestId('document-frontmatter')).toContainText('target: system.stripe')
  await expect(page.getByRole('link', { name: 'Show in graph' })).toHaveAttribute('href', `/o/${org}/w/acme/graph#service.orders`)
  // The Documents tab stays current on a document's page.
  await expect(page.getByRole('navigation', { name: 'Docket' }).getByRole('link', { name: 'Documents' })).toHaveAttribute('aria-current', 'page')

  // A new revision: the page shows it, and the first is still there to read.
  const original = await page.getByTestId('document-frontmatter').innerText()
  await page.goto(`/o/${org}/w/acme/documents`)
  await page.locator('input[name="files"]').setInputFiles({
    name: 'orders.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('---\nid: service.orders\ntype: service\ntitle: Orders\n---\nTakes and tracks every order.\n'),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 1 document.')).toBeVisible()
  await page.getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page.getByTestId('document-body')).toHaveText('Takes and tracks every order.')
  const revisions = page.getByRole('complementary', { name: 'Revisions' })
  await expect(revisions.getByRole('listitem')).toHaveCount(2)
  await revisions.getByRole('link', { name: 'Revision 1' }).click()
  await expect(page.getByRole('status')).toContainText('Revision 1 of 2')
  await expect(page.getByTestId('document-frontmatter')).toHaveText(original)

  expect((await page.goto(`/o/${org}/w/acme/documents/.docket/resources/service/nope.md`))?.status()).toBe(404)
  await page.context().close()
})

test('an owner deletes a workspace by typing its slug; an editor cannot', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const suffix = unique()
  const bob = `bob${suffix}`
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  const org = await createOrg(alice, `Delete ${suffix}`)
  await acmeWorkspace(alice, org)
  await acmeWorkspace(alice, org, 'Kept')
  const token = await createToken(alice, org, 'acme', { scopes: ['docket:read'], description: 'goes with the workspace' })
  expect((await mcp(request, `/mcp/${org}/acme`, token, 'tools/list')).status()).toBe(200)
  if (WORKER) {
    await alice.goto(`/o/${org}/w/acme/graph`)
    await expect(alice.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
  }

  // An editor sees no delete, and a crafted post is refused.
  await inviteEditor(alice, org, bob)
  const bobPage = await (await browser.newContext()).newPage()
  await signIn(bobPage, bob)
  await bobPage.getByRole('button', { name: `Accept and join Delete ${suffix}` }).click()
  await bobPage.goto(`/o/${org}/w/acme/settings`)
  await expect(bobPage.getByRole('heading', { name: 'Delete this docket' })).toHaveCount(0)
  const refused = await bobPage.request.post(`/o/${org}/w/acme/settings?/delete`, {
    form: { csrf: await csrfOf(bobPage), confirm: 'acme' },
    headers: { origin: new URL(bobPage.url()).origin },
  })
  expect(refused.status()).toBe(403)

  // The owner must type the slug; the button waits for it, and a wrong one is refused.
  await alice.goto(`/o/${org}/w/acme/settings`)
  const button = alice.getByRole('button', { name: 'Delete docket' })
  await expect(button).toBeDisabled()
  const wrong = await alice.request.post(`/o/${org}/w/acme/settings?/delete`, {
    form: { csrf: await csrfOf(alice), confirm: 'kept' },
    headers: { origin: new URL(alice.url()).origin },
  })
  expect(await wrong.text()).toContain('Type acme to delete this docket.')
  await alice.getByLabel('Type acme to confirm').fill('acme')
  await button.click()
  await expect(alice).toHaveURL(new RegExp(`/o/${org}\\?deleted=acme$`))
  await expect(alice.getByRole('status')).toHaveText('Deleted the docket acme.')
  const workspaces = alice.getByRole('navigation', { name: 'Sidebar' }).getByRole('list', { name: 'Dockets' })
  await expect(workspaces.getByRole('link', { name: 'Kept' })).toBeVisible()
  await expect(workspaces.getByRole('link', { name: 'Acme', exact: true })).toHaveCount(0)
  expect((await alice.goto(`/o/${org}/w/acme`))?.status()).toBe(404)

  // Its token is revoked and the endpoint is gone; the other workspace is untouched.
  expect((await mcp(request, `/mcp/${org}/acme`, token, 'tools/list')).status()).toBe(401)
  await alice.goto(`/o/${org}/w/kept/documents`)
  await expect(alice.getByRole('table', { name: 'Documents' }).locator('tbody tr')).toHaveCount(21)

  // The org's audit log keeps the deletion.
  await alice.goto(`/o/${org}/audit`)
  await expect(alice.getByRole('cell', { name: 'workspace.delete', exact: true })).toBeVisible()
  await expect(alice.getByTestId('chain')).toContainText('Chain verified')

  const state = await superuser(async (client) => {
    const schema = await orgSchema(client, org)
    const deletion = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM "${schema}".workspace_deletions WHERE slug = 'acme'`)
    const workspaceId = deletion.rows[0]?.workspace_id ?? ''
    const left = await client.query<{ count: string }>(`SELECT count(*) FROM "${schema}".documents WHERE workspace_id = $1`, [workspaceId])
    const tokens = await client.query<{ revoked: boolean }>('SELECT revoked_at IS NOT NULL AS revoked FROM platform.api_tokens WHERE $1 = ANY (dockets)', [workspaceId])
    return { workspaceId, documents: Number(left.rows[0]?.count), tokens: tokens.rows.map((row) => row.revoked) }
  })
  expect(state.workspaceId).not.toBe('')
  expect(state.documents).toBe(0)
  expect(state.tokens).toEqual([true])

  // The worker clears its projections.
  if (WORKER) {
    await expect
      .poll(
        () =>
          superuser(async (client) => {
            const schema = await orgSchema(client, org)
            const { rows } = await client.query<{ purged: boolean }>(`SELECT purged_at IS NOT NULL AS purged FROM "${schema}".workspace_deletions WHERE slug = 'acme'`)
            return rows[0]?.purged
          }),
        { timeout: 30_000 },
      )
      .toBe(true)
  }
  await alice.context().close()
  await bobPage.context().close()
})

async function inviteEditor(page: Page, org: string, login: string) {
  await page.goto(`/o/${org}/members`)
  await page.getByLabel('GitHub login or email').fill(`@${login}`)
  await page.locator('form[action="?/invite"] select[name="role"]').selectOption('editor')
  await page.getByRole('button', { name: 'Send invite' }).click()
  await expect(page.getByText(`Invited @${login} as editor.`)).toBeVisible()
}
