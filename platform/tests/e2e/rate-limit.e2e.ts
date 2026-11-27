// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import pg from 'pg'

import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

/**
 * The MCP rate limit (§12, plan M9 step 1) through the real endpoint and the
 * token buckets in Postgres: a token's 121st call in a minute is a 429 with
 * Retry-After, an MCP tool error the model can read, and an audit event with
 * outcome denied.
 */

let org = ''
let token = ''
let other = ''
const endpoint = () => `/mcp/${org}/acme`

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  org = await createOrg(page, `Limits ${unique()}`)
  await acmeWorkspace(page, org)
  token = await createToken(page, org, 'acme', { scopes: ['docket:read'], description: 'e2e limits' })
  other = await createToken(page, org, 'acme', { scopes: ['docket:read'], description: 'e2e limits, untouched' })
  await page.context().close()
})

/** The org's denied audit events, read as Postgres' superuser would. */
async function deniedEvents(): Promise<{ actor: string; action: string; target: string[] }[]> {
  const url = new URL(process.env.DOCKET_TEST_PG_URL ?? '')
  url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>('SELECT id FROM platform.orgs WHERE slug = $1', [org])
    const schema = `org_${rows[0]?.id ?? ''}`
    if (!/^org_[a-z0-9]{1,40}$/.test(schema)) throw new Error('no such org')
    const events = await client.query(`SELECT actor, action, target FROM "${schema}".audit_event WHERE outcome = 'denied' ORDER BY seq`)
    return events.rows
  } finally {
    await client.end()
  }
}

test("a token's 121st call in a minute is a 429 with Retry-After, an MCP tool error and an audit denied event", async ({ request }) => {
  const ontology = () => mcp(request, endpoint(), token, 'tools/call', { name: 'docket_ontology', arguments: {} })
  const started = Date.now()
  const first = await Promise.all(Array.from({ length: 120 }, () => ontology()))
  expect(first.map((response) => response.status()).filter((status) => status !== 200)).toEqual([])

  // The bucket refills at 2 calls a second while the calls run, so the refusal comes by the 121st call plus that refill.
  const refilled = Math.ceil(((Date.now() - started) / 1000) * 2) + 1
  let limited = await ontology()
  for (let extra = 0; limited.status() === 200 && extra < refilled; extra += 1) limited = await ontology()
  expect(limited.status()).toBe(429)
  expect(Number(limited.headers()['retry-after'])).toBeGreaterThanOrEqual(1)
  const body = (await limited.json()) as { result: { isError: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> } }
  expect(body.result.isError).toBe(true)
  expect(body.result.content[0]?.text).toContain('at most 120 calls a minute per token')
  expect(body.result.structuredContent).toMatchObject({ error: 'rate_limited', scope: 'token', limitPerMinute: 120 })

  expect(await deniedEvents()).toEqual([
    { actor: `token:${token.slice(0, 16)}`, action: 'mcp.tools/call docket_ontology', target: ['rate-limit:calls-per-token'] },
  ])

  // Another token in the same org still gets through: the org allows 600 a minute.
  expect((await mcp(request, endpoint(), other, 'tools/list')).status()).toBe(200)
})
