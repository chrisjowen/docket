// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIRequestContext } from '@playwright/test'
import pg from 'pg'

import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

/**
 * Writes with evidence (§9, §9.1, §14.2; M6 step 4): the G5 write scenario.
 * An MCP write without evidence is refused; one with evidence is stamped with
 * its writer, lands in the activity log with its audit event, and search
 * finds it within seconds; a repo-origin document cannot be retired over MCP;
 * a superseded one stays on file but leaves search's answers for its replacement;
 * the graph's capture forms post the same write.
 */

/** The worker runs when serve.mjs has stores to project into (CI does). */
const WORKER = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)

let org = ''
let writer = ''
let reader = ''
const endpoint = () => `/mcp/${org}/acme`

type Result = {
  result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
  error?: { message: string }
}

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>, bearer = writer): Promise<Result> {
  const response = await mcp(request, endpoint(), bearer, 'tools/call', { name, arguments: args })
  expect(response.status()).toBe(200)
  return (await response.json()) as Result
}

/** A superuser connection to the e2e database, and the org's schema in it. */
async function orgDb<T>(fn: (client: pg.Client, schema: string) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DOCKET_TEST_PG_URL ?? '')
  url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>('SELECT id FROM platform.orgs WHERE slug = $1', [org])
    const schema = `org_${rows[0]?.id ?? ''}`
    if (!/^org_[a-z0-9]{1,40}$/.test(schema)) throw new Error('no such org')
    return await fn(client, schema)
  } finally {
    await client.end()
  }
}

test.beforeAll(async ({ browser }) => {
  // Waits up to 60 s for the index below; the default 30 s would cut it short.
  test.setTimeout(90_000)
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Writes ${unique()}`)
  await acmeWorkspace(page, org)
  writer = await createToken(page, org, 'acme', { scopes: ['docket:read', 'docket:write', 'ontology:propose'], description: 'e2e writer' })
  reader = await createToken(page, org, 'acme', { scopes: ['docket:read'], description: 'e2e reader' })
  if (WORKER) {
    await page.goto(`/o/${org}/w/acme/graph`)
    await expect(page.getByTestId('index-status')).toHaveText('Index up to date', { timeout: 60_000 })
  }
  await page.context().close()
})

test('a writing token lists the write tools; a reading token cannot call them', async ({ request }) => {
  const listed = (await (await mcp(request, endpoint(), writer, 'tools/list')).json()) as Result
  expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
    'docket_search',
    'docket_get',
    'docket_ask',
    'docket_ontology',
    'docket_remember',
    'docket_update_notes',
    'docket_add_evidence',
    'docket_retire',
    'docket_supersede',
    'docket_propose_ontology_change',
  ])
  const refused = await mcp(request, endpoint(), reader, 'tools/call', { name: 'docket_remember', arguments: { id: 'service.x', type: 'service', title: 'X', evidence: [] } })
  expect(refused.status()).toBe(403)
  expect(refused.headers()['www-authenticate']).toContain('insufficient_scope')
})

test('an MCP write without evidence is refused with missing-evidence, and nothing is written', async ({ request }) => {
  const id = `service.unevidenced-${unique()}`
  const refused = await call(request, 'docket_remember', { id, type: 'service', title: 'Unevidenced', evidence: [] })
  expect(refused.result?.isError).toBe(true)
  expect(refused.result?.content?.[0]?.text).toContain('missing-evidence')
  const missing = await call(request, 'docket_get', { id })
  expect(missing.result?.isError).toBe(true)
  const audit = await orgDb((client, schema) =>
    client.query<{ action: string; outcome: string; target: string[] }>(`SELECT action, outcome, target FROM "${schema}".audit_event ORDER BY seq DESC LIMIT 2`),
  )
  expect(audit.rows[1]).toEqual({ action: 'mcp.tools/call docket_remember', outcome: 'invalid', target: [id] })
})

test('docket_remember then docket_search finds the resource within 10 s', async ({ request }) => {
  test.skip(!WORKER, 'needs the worker and its stores')
  const marker = `quokka${unique()}`
  const id = `service.${marker}`
  const written = await call(request, 'docket_remember', {
    id,
    type: 'service',
    title: `Ledger ${marker}`,
    body: `The ${marker} ledger keeps double-entry accounts for orders.`,
    links: [{ rel: 'depends_on', target: 'service.orders', evidence: [{ source: 'code', path: 'ledger/orders.go', lines: '10-30' }] }],
    evidence: [{ source: 'code', path: 'ledger/main.go', note: 'the service entry point' }],
  })
  expect(written.result?.isError).toBeFalsy()
  expect(written.result?.structuredContent).toMatchObject({ schema: 'docket-write.v1', ok: true, created: true, changed: true, evidenceAdded: 2 })

  const started = Date.now()
  let found: string[] = []
  while (Date.now() - started < 10_000) {
    const search = await call(request, 'docket_search', { query: marker })
    found = ((search.result?.structuredContent as { matches?: { id: string }[] } | undefined)?.matches ?? []).map((match) => match.id)
    if (found.includes(id)) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  expect(found).toContain(id)
})

test('docket_supersede keeps an out-of-date record on file but out of search answers, and the inspector says what replaced it', async ({ request, browser }) => {
  const marker = `muse${unique()}`
  const [sophia, captin] = [`service.sophia-${marker}`, `service.captin-${marker}`]
  const evidence = [{ source: 'human', note: 'said in the chris-muse workspace' }]
  for (const [id, title, body] of [
    [sophia, `Sophia ${marker}`, `Sophia ${marker} is the Muse bot that answers questions about orders.`],
    [captin, `Captin ${marker}`, `Captin ${marker} is the Muse bot that answers questions about orders.`],
  ] as const) {
    expect((await call(request, 'docket_remember', { id, type: 'service', title, body, evidence })).result?.isError).toBeFalsy()
  }
  const superseded = await call(request, 'docket_supersede', {
    id: sophia,
    by: captin,
    reason: `The Muse bot was renamed from Sophia ${marker} to Captin ${marker}.`,
    // Chris said so (a person, 0.7) and the changelog says so (docs, 0.6): 0.88, over the 0.75 bar.
    evidence: [
      { source: 'human', note: 'Chris renamed the bot' },
      { source: 'docs', path: 'CHANGELOG.md', note: 'the rename is in the changelog' },
    ],
  })
  expect(superseded.result?.isError).toBeFalsy()
  expect(superseded.result?.structuredContent).toMatchObject({
    tool: 'docket_supersede',
    ok: true,
    changed: true,
    supersededBy: captin,
    status: 'accepted',
    proposal: { status: 'accepted', score: 0.88, threshold: 0.75 },
  })

  const got = await call(request, 'docket_get', { id: sophia })
  expect(got.result?.content?.[0]?.text).toContain(`Out of date: "Sophia ${marker}" (${sophia}) is superseded by "Captin ${marker}" (${captin})`)

  if (WORKER) {
    type Found = { matches?: { id: string }[]; changes?: { id: string; current: { id: string } | null }[] }
    const started = Date.now()
    let found: Found = {}
    while (Date.now() - started < 10_000) {
      found = ((await call(request, 'docket_search', { query: `who is Sophia ${marker}` })).result?.structuredContent ?? {}) as Found
      if (found.changes?.length) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    expect(found.changes).toEqual([expect.objectContaining({ id: sophia, current: expect.objectContaining({ id: captin }) })])
    expect(found.matches?.map((match) => match.id)).toContain(captin)
    expect(found.matches?.map((match) => match.id)).not.toContain(sophia)
  }

  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  await page.goto(`/o/${org}/w/acme/graph?focus=${encodeURIComponent(sophia)}`)
  const banner = page.getByTestId('inspector').getByTestId('superseded')
  await expect(banner).toContainText('Overruled')
  await expect(banner).toContainText(`renamed from Sophia ${marker}`)
  await banner.getByRole('button', { name: `Captin ${marker}` }).click()
  await expect(page.getByTestId('inspector').getByRole('heading', { name: `Captin ${marker}` })).toBeVisible()
  await expect(page.getByTestId('inspector').getByTestId('supersedes')).toContainText(`Sophia ${marker}`)
  await page.context().close()
})

test('a write is stamped with its writer, recorded once in the audit log, and shown in the activity log', async ({ request, browser }) => {
  const id = `service.stamped-${unique()}`
  const written = await call(request, 'docket_remember', {
    id,
    type: 'service',
    title: 'Stamped',
    evidence: [{ source: 'human', note: 'said in standup', observedBy: 'someone-else' }],
  })
  expect(written.result?.isError).toBeFalsy()

  const got = await call(request, 'docket_get', { id })
  const resource = got.result?.structuredContent as { resource: { evidence: { observedBy?: string; session?: string }[] }; documents: { origin: string }[] }
  // The token is the observer, by its owner's login; the client's claim is kept as reportedBy in the canonical file.
  expect(resource.resource.evidence[0]?.observedBy).toMatch(/^alice \(token tok_[a-z0-9]{4}…\)$/)
  expect(resource.documents[0]?.origin).toBe('cloud')

  const rows = await orgDb(async (client, schema) => {
    const audit = await client.query<{ action: string; outcome: string; target: string[]; request_id: string }>(
      `SELECT action, outcome, target, request_id FROM "${schema}".audit_event WHERE $1 = ANY(target) ORDER BY seq`,
      [id],
    )
    const ingest = await client.query<{ channel: string; action: string; request_id: string; outcome: string }>(
      `SELECT channel, action, request_id, outcome FROM "${schema}".ingest_events WHERE documents @> $1::jsonb`,
      [JSON.stringify([{ resourceId: id }])],
    )
    return { audit: audit.rows, ingest: ingest.rows }
  })
  const remembered = rows.audit.filter((event) => event.action === 'mcp.tools/call docket_remember')
  expect(remembered).toHaveLength(1)
  expect(remembered[0]?.outcome).toBe('ok')
  // The ingest event links to that audit event by the request id that is also each evidence entry's session.
  expect(rows.ingest).toEqual([{ channel: 'mcp', action: 'remember', request_id: remembered[0]?.request_id, outcome: 'ok' }])
  expect(resource.resource.evidence[0]?.session).toBe(remembered[0]?.request_id)

  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  await page.goto(`/o/${org}/w/acme/activity?channel=mcp`)
  const entry = page.getByTestId('activity-event').filter({ hasText: id })
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('MCP')
  await expect(entry).toContainText('said in standup')
  await expect(entry).toContainText('someone-else')
  await entry.getByRole('link', { name: 'Audit event' }).click()
  await expect(page.getByTestId('request-filter')).toContainText(remembered[0]?.request_id ?? '')
  await page.context().close()
})

test('docket_retire on a repo-origin document is refused with "change it in the repo"', async ({ request }) => {
  // Repo sync (M7) writes origin=repo documents; stand one in for it.
  await orgDb((client, schema) =>
    client.query(`UPDATE "${schema}".documents SET origin = 'repo', origin_ref = 'conn-e2e:.docket' WHERE resource_id = 'service.checkout' AND retired_at IS NULL`),
  )
  const refused = await call(request, 'docket_retire', { id: 'service.checkout', reason: 'replaced' })
  expect(refused.result?.isError).toBe(true)
  expect(refused.result?.content?.[0]?.text).toContain('change it in the repo')
  expect((await call(request, 'docket_get', { id: 'service.checkout' })).result?.isError).toBeFalsy()

  // A cloud document retires, with its reason in the activity log.
  const retired = await call(request, 'docket_retire', { id: 'system.databricks', reason: 'moved to the data team' })
  expect(retired.result?.isError).toBeFalsy()
  expect((await call(request, 'docket_get', { id: 'system.databricks' })).result?.isError).toBe(true)
})

test('docket_propose_ontology_change makes a draft and never publishes', async ({ request }) => {
  const proposed = await call(request, 'docket_propose_ontology_change', {
    patch: 'resourceTypes:\n  queue:\n    description: A message queue.\n',
    message: 'Queues show up in the code',
  })
  expect(proposed.result?.isError).toBeFalsy()
  expect(proposed.result?.structuredContent).toMatchObject({ schema: 'docket-ontology-proposal.v1', head: 1, classification: 'safe' })
  const ontology = await call(request, 'docket_ontology', {})
  expect(ontology.result?.structuredContent).toMatchObject({ version: 1 })
})

test('write tools count against 30 writes a minute per token', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const busy = await createToken(page, org, 'acme', { scopes: ['docket:read', 'docket:write'], description: 'e2e busy writer' })
  await page.context().close()
  const args = { id: 'service.orders', type: 'service', title: 'Orders', evidence: [{ source: 'human' }], dryRun: true }
  const write = () => mcp(request, endpoint(), busy, 'tools/call', { name: 'docket_remember', arguments: args })
  // A token bucket (§12): a burst of 30, refilling one write every 2 s, so writes past the burst
  // are allowed only as fast as the bucket refills while they run.
  const started = Date.now()
  const burst = await Promise.all(Array.from({ length: 30 }, write))
  expect(burst.map((response) => response.status())).toEqual(Array(30).fill(200))
  let limited = await write()
  let extra = 0
  while (limited.status() === 200 && extra < 30) {
    extra += 1
    limited = await write()
  }
  expect(limited.status()).toBe(429)
  expect(extra).toBeLessThanOrEqual(Math.ceil((Date.now() - started) / 2000))
  expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0)
  const body = (await limited.json()) as Result
  expect(body.result?.isError).toBe(true)
  expect(body.result?.content?.[0]?.text).toContain('30 writes a minute')
  // Reads are not writes.
  expect((await mcp(request, endpoint(), busy, 'tools/call', { name: 'docket_ontology', arguments: {} })).status()).toBe(200)
})

test('the graph capture forms write a resource with evidence, and show a refusal with its reasons', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  await page.goto(`/o/${org}/w/acme/graph`)
  await page.getByTestId('capture-toggle').click()
  const panel = page.getByTestId('capture')
  await panel.getByRole('tab', { name: 'New resource' }).click()
  await panel.getByRole('combobox', { name: 'Type', exact: true }).selectOption('service')
  const title = `Billing ${unique()}`
  await panel.getByLabel('Title').fill(title)
  const id = await panel.getByLabel('Id').inputValue()
  expect(id).toMatch(/^service\.billing-[0-9a-f]{6}$/)

  // The evidence form follows the source: code needs a path.
  await panel.getByRole('combobox', { name: 'Source', exact: true }).selectOption('code')
  await expect(panel.getByRole('textbox', { name: /^path/ })).toHaveAttribute('required', '')
  await panel.getByRole('textbox', { name: /^path/ }).fill('billing/main.go')
  await panel.getByLabel('Note').fill('the billing entry point')
  await panel.getByRole('button', { name: 'Capture service' }).click()
  await expect(page.getByText(`Captured ${id}.`)).toBeVisible()

  // A refusal comes back to the form with the validator's reasons: a team cannot be written as a service.
  await panel.getByRole('combobox', { name: 'Type', exact: true }).selectOption('service')
  await panel.getByLabel('Title').fill('Platform engineering')
  await panel.getByLabel('Id').fill('team.platform-engineering')
  await panel.getByRole('combobox', { name: 'Source', exact: true }).selectOption('human')
  await panel.getByRole('button', { name: 'Capture service' }).click()
  await expect(page.getByTestId('capture-diagnostics')).toContainText('type-conflict')

  await page.goto(`/o/${org}/w/acme/activity?channel=ui`)
  const entry = page.getByTestId('activity-event').filter({ hasText: id })
  await expect(entry).toContainText('@alice')
  await expect(entry).toContainText('billing/main.go')
  await expect(entry).toContainText('alice (web)')
  await expect(page.getByTestId('activity-event').filter({ hasText: 'team.platform-engineering' })).toContainText('refused')
  await page.context().close()
})
