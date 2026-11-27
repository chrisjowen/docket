// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { createOrg, signIn, unique } from './helpers'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'workspace')
const ontology = readFileSync(join(FIXTURE, '.docket', 'entities.yaml'), 'utf8')
const documents = readdirSync(join(FIXTURE, '.docket'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => {
    const path = join(entry.parentPath, entry.name)
    return { name: relative(FIXTURE, path).replace(/\//g, '_'), mimeType: 'text/markdown', buffer: readFileSync(path) }
  })

// One org for these tests, each in a workspace of its own: the beta holds 8 orgs, and the suite shares a database.
let slug = ''
test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  slug = await createOrg(page, `Ontology ${unique()}`)
  await page.context().close()
})

/** Creates a workspace whose ontology is the fixture's entities.yaml, and loads the 12 fixture documents into it. */
async function platformWorkspace(page: Page, name: string): Promise<string> {
  const ws = name.toLowerCase()
  await page.goto(`/o/${slug}/workspaces/new`)
  await page.getByLabel('Name').fill(name)
  await page.getByText('An entities.yaml file').click()
  await page.getByLabel('Upload .docket/entities.yaml').setInputFiles({
    name: 'entities.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from(ontology),
  })
  await page.getByRole('button', { name: 'Create docket' }).click()
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/w/${ws}/ontology$`))
  await expect(page.getByTestId('ontology-status')).toContainText('v1 is published')

  await page.goto(`/o/${slug}/w/${ws}/documents`)
  await page.locator('input[name="files"]').setInputFiles(documents)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Wrote 12 documents.')).toBeVisible()
  await expect(page.getByTestId('findings')).toHaveText('0 with findings')
  return `/o/${slug}/w/${ws}`
}

/**
 * G4 (spec §1): the cloud is the source of truth for the ontology, with a web
 * editor, version history and checks before a change applies. A change that
 * would break existing resources is shown with its diagnostics and blocked
 * until it is resolved.
 */
test('G4: a breaking ontology change is shown with its diagnostics and blocked until a migration resolves it', async ({ page }) => {
  await signIn(page, 'alice')
  const ws = await platformWorkspace(page, 'Platform')

  await page.goto(`${ws}/ontology`)
  await page.getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\?draft=/)
  await expect(page.getByTestId('classification')).toHaveText('safe')

  // Remove the pod type, which two documents use.
  await page.getByRole('button', { name: 'pod 2' }).click()
  await page.getByRole('button', { name: 'Remove type' }).click()
  await expect(page.getByTestId('classification')).toHaveText('breaking')
  const blocking = page.getByTestId('blocking')
  await expect(blocking).toContainText('Blocked: 2 resources would become unknown to the ontology.')
  for (const pod of ['pod.orders-7f9c', 'pod.payments-5d2a']) {
    await expect(page.locator(`li[data-resource="${pod}"]`)).toContainText('unknown-type')
  }
  const publish = page.getByRole('button', { name: 'Publish v2' })
  await expect(publish).toBeDisabled()
  await expect(page.getByTestId('publish-blocked')).toHaveText('Blocked until the breaking change is resolved.')

  // Around the UI: the server refuses it too.
  const crafted = await page.request.post(`${ws}/ontology?/publish`, {
    form: {
      csrf: await page.locator('input[name="csrf"]').first().inputValue(),
      draft: new URL(page.url()).searchParams.get('draft') ?? '',
      yaml: ontology.replace(/ {2}pod:\n {4}description: A running instance of a service.\n {4}icon: box\n/, ''),
      expectedHead: '1',
      acceptNarrowing: 'on',
    },
    headers: { origin: new URL(page.url()).origin, accept: 'text/html' },
    maxRedirects: 0,
  })
  expect(crafted.status()).toBe(422)

  // Resolve it: add a container type and migrate the pods to it.
  await page.getByLabel('New type name').fill('container')
  await page.getByRole('button', { name: 'Add type' }).click()
  await expect(page.getByTestId('classification')).toHaveText('breaking')
  await page.getByRole('button', { name: 'Migrate type pod' }).click()
  await page.getByLabel('To, step 1').selectOption('container')
  // Nothing is left unknown; the policies about pods no longer price the migrated containers, so it rescores.
  await expect(page.getByTestId('classification')).toHaveText('rescore')
  await expect(page.getByText('with the migration rewriting 2')).toBeVisible()
  await page.getByLabel('Message', { exact: true }).fill('Pods are containers')
  await expect(publish).toBeEnabled()
  await publish.click()

  await expect(page).toHaveURL(new RegExp(`${ws}/ontology/history\\?published=2$`))
  await expect(page.getByText('Published v2.')).toBeVisible()
  const v2 = page.locator('li[data-version="2"]')
  await expect(v2).toContainText('Pods are containers')
  await expect(v2.getByRole('list', { name: 'Changes in v2' })).toContainText('type container')
  await expect(v2.getByRole('list', { name: 'Changes in v2' })).toContainText('type pod')
  await expect(v2).toContainText('renameType pod -> container')

  // The cloud documents were rewritten as new revisions, and still validate.
  await page.goto(`${ws}/documents`)
  await expect(page.getByTestId('findings')).toHaveText('0 with findings')
  const pod = page.locator('tr[data-resource="pod.orders-7f9c"]')
  await expect(pod.locator('td').nth(1)).toHaveText('container')
  await expect(pod.locator('td').nth(3)).toHaveText('2')

  // Every step is in the org's audit log.
  await page.goto(`/o/${slug}/audit`)
  for (const action of ['workspace.create', 'documents.import', 'ontology.draft.create', 'ontology.publish']) {
    await expect(page.getByRole('cell', { name: action, exact: true }).first()).toBeVisible()
  }
})

test('a narrowing change needs "publish anyway", and a rollback publishes the old version again', async ({ page }) => {
  await signIn(page, 'alice')
  const ws = await platformWorkspace(page, 'Narrow')

  await page.goto(`${ws}/ontology`)
  await page.getByRole('button', { name: 'Start a draft' }).click()
  // On the type, where its relations are: depends_on stops pointing to datasources.
  await page.getByRole('navigation', { name: 'Types' }).getByRole('button', { name: /^service/ }).click()
  await page.getByRole('button', { name: 'Stop depends_on pointing to datasource' }).click()
  await expect(page.getByTestId('classification')).toHaveText('narrowing')
  for (const service of ['service.orders', 'service.payments', 'service.catalogue']) {
    await expect(page.locator(`li[data-resource="${service}"]`)).toContainText('relationship-to-violation')
  }
  const publish = page.getByRole('button', { name: 'Publish v2' })
  await expect(publish).toBeDisabled()
  await page.getByLabel('Publish anyway').check()
  await publish.click()
  await expect(page.getByText('Published v2.')).toBeVisible()
  await expect(page.locator('li[data-version="2"]')).toContainText('3 resource(s) gaining diagnostics')

  // The documents show the diagnostics they gained.
  await page.goto(`${ws}/documents`)
  await expect(page.getByTestId('findings')).toHaveText('3 with findings')

  // Roll back to v1: v3 equals v1, and the findings are gone.
  await page.goto(`${ws}/ontology/history`)
  await page.getByRole('button', { name: 'Roll back to v1' }).click()
  await expect(page.getByText('Published v3.')).toBeVisible()
  const v1 = await (await page.request.get(`${ws}/ontology/export?v=1`)).text()
  const v3 = await (await page.request.get(`${ws}/ontology/export?v=3`)).text()
  expect(v3.split('\n').slice(1).join('\n')).toBe(v1.split('\n').slice(1).join('\n'))
  await page.goto(`${ws}/documents`)
  await expect(page.getByTestId('findings')).toHaveText('0 with findings')
})

test('the YAML exported after an import equals the imported file, apart from the header comment', async ({ page }) => {
  await signIn(page, 'alice')
  await page.goto(`/o/${slug}/workspaces/new`)
  await page.getByLabel('Name').fill('Blank start')
  await page.getByText('Blank', { exact: true }).click()
  await page.getByRole('button', { name: 'Create docket' }).click()
  const ws = `/o/${slug}/w/blank-start`
  await expect(page).toHaveURL(`${ws}/ontology`)

  // Import makes a draft; publishing it runs the same checks.
  await page.getByText('Import an entities.yaml as a draft').click()
  await page.locator('form[action="?/import"] input[type="file"]').setInputFiles({
    name: 'entities.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from(ontology),
  })
  await page.getByRole('button', { name: 'Import as a draft' }).click()
  await expect(page).toHaveURL(/\?draft=/)
  await expect(page.getByTestId('classification')).toHaveText('safe')
  await page.getByRole('button', { name: 'Publish v2' }).click()
  await expect(page.getByText('Published v2.')).toBeVisible()

  const response = await page.request.get(`${ws}/ontology/export`)
  expect(response.headers()['content-disposition']).toContain('entities.yaml')
  const exported = await response.text()
  const [header, ...rest] = exported.split('\n')
  expect(header).toMatch(new RegExp(`^# docket-cloud: ${slug}/blank-start ontology v2 \\(sha256:[0-9a-f]{64}\\)$`))
  expect(rest.join('\n')).toBe(ontology)

  // A schema error is reported with its path, and makes no draft.
  await page.goto(`${ws}/ontology`)
  await page.getByText('Import an entities.yaml as a draft').click()
  await page.getByLabel('or paste it').fill('version: 1\nrelationships:\n  uses:\n    from: [service]\n')
  await page.getByRole('button', { name: 'Import as a draft' }).click()
  await expect(page.getByRole('alert')).toContainText('relationships.uses.to:')
})

test('an editor proposes drafts but cannot publish them', async ({ browser }) => {
  const suffix = unique()
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  await alice.goto(`/o/${slug}/workspaces/new`)
  await alice.getByLabel('Name').fill('Roles')
  await alice.getByRole('button', { name: 'Create docket' }).click()
  await alice.goto(`/o/${slug}/members`)
  const erin = `erin${suffix}`
  await alice.getByLabel('GitHub login or email').fill(`@${erin}`)
  await alice.getByRole('button', { name: 'Send invite' }).click()

  const page = await (await browser.newContext()).newPage()
  await signIn(page, erin)
  await page.getByRole('button', { name: /^Accept and join Ontology / }).click()
  await page.goto(`/o/${slug}/w/roles/ontology`)
  await page.getByRole('button', { name: 'Start a draft' }).click()
  await page.getByLabel('New type name').fill('cost-centre')
  await page.getByRole('button', { name: 'Add type' }).click()
  await expect(page.getByTestId('classification')).toHaveText('safe')
  await expect(page.getByRole('button', { name: 'Publish v2' })).toBeDisabled()
  await expect(page.getByTestId('publish-blocked')).toContainText('Only owners and admins publish')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()

  // Around the UI: the server refuses the publish.
  const draft = new URL(page.url()).searchParams.get('draft') ?? ''
  const refused = await page.request.post(`/o/${slug}/w/roles/ontology?/publish`, {
    form: { csrf: await page.locator('input[name="csrf"]').first().inputValue(), draft, expectedHead: '1' },
    headers: { origin: new URL(page.url()).origin, accept: 'text/html' },
    maxRedirects: 0,
  })
  expect(refused.status()).toBe(403)

  // The owner sees the draft and publishes it.
  await alice.goto(`/o/${slug}/w/roles/ontology`)
  await alice.getByRole('link', { name: /Draft from the head/ }).click()
  await expect(alice.getByTestId('classification')).toHaveText('safe')
  await alice.getByRole('button', { name: 'Publish v2' }).click()
  await expect(alice.getByText('Published v2.')).toBeVisible()
})
