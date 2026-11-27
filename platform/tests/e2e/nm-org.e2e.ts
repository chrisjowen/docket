// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

const log = (s: string) => console.log(`EVIDENCE ${s}`)
const db = () => { const url = new URL(process.env.DOCKET_TEST_PG_URL ?? ''); url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`; return new pg.Client({ connectionString: url.toString() }) }

test('org bucket exhausted refuses a fresh token with the org-scope 429', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const org = await createOrg(page, `NMorg ${unique()}`)
  await acmeWorkspace(page, org)
  const a = await createToken(page, org, 'acme', { scopes: ['docket:read'] })
  const b = await createToken(page, org, 'acme', { scopes: ['docket:read'] })
  const ep = `/mcp/${org}/acme`
  expect((await mcp(request, ep, a, 'tools/list')).status()).toBe(200)
  const c = db(); await c.connect()
  try {
    const keys = (await c.query('SELECT key, tokens FROM platform.rate_buckets ORDER BY key')).rows
    const { rows } = await c.query('SELECT id FROM platform.orgs WHERE slug = $1', [org])
    const orgId = rows[0].id as string
    const mine = keys.filter((k) => String(k.key).includes(orgId) || keys.length < 50)
    log(`buckets after one call: ${JSON.stringify(mine.filter((k) => String(k.key).includes(orgId)))}`)
    const orgKey = mine.map((k) => String(k.key)).find((k) => k.includes(orgId) && k.includes('org'))
    log(`org key=${orgKey}`)
    // Simulate 600 calls already spent this minute by the org: drain the shared bucket.
    await c.query("UPDATE platform.rate_buckets SET tokens = 0, updated_at = clock_timestamp() + interval '3 seconds' WHERE key = $1", [orgKey])
    const r = await mcp(request, ep, b, 'tools/call', { name: 'docket_ontology', arguments: {} })
    log(`token b (unused) status=${r.status()} retry-after=${r.headers()["retry-after"]} body=${(await r.text()).slice(0, 600)}`)
    expect(r.status()).toBe(429)
    const ev = (await c.query(`SELECT actor, action, target, outcome FROM "org_${orgId}".audit_event WHERE outcome='denied' ORDER BY seq`)).rows
    log(`denied audit: ${JSON.stringify(ev)}`)
    const tokenB = (await c.query('SELECT tokens FROM platform.rate_buckets WHERE key LIKE $1', [`%token%`])).rows.length
    log(`token bucket rows: ${tokenB}`)
  } finally { await c.end() }
})
