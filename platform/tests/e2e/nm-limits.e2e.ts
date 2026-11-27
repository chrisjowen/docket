// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

test.setTimeout(300_000)
const log = (s: string) => console.log(`EVIDENCE ${s}`)

const db = () => { const url = new URL(process.env.DOCKET_TEST_PG_URL ?? ''); url.pathname = `/${process.env.E2E_DB ?? 'docket_e2e'}`; return new pg.Client({ connectionString: url.toString() }) }

/** Empties a token's call bucket for the next few seconds, so a refusal does not depend on how fast the client is. */
async function drainToken(org: string, description: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query('SELECT t.id FROM platform.api_tokens t JOIN platform.orgs o ON o.id = t.org_id WHERE o.slug = $1 AND t.description = $2', [org, description])
    await c.query("UPDATE platform.rate_buckets SET tokens = 0, updated_at = clock_timestamp() + interval '5 seconds' WHERE key = $1", [`mcp:token:${rows[0].id}`])
  } finally { await c.end() }
}

async function denied(org: string) {
  const c = db(); await c.connect()
  try {
    const { rows } = await c.query('SELECT id FROM platform.orgs WHERE slug = $1', [org])
    return (await c.query(`SELECT actor, action, target FROM "org_${rows[0].id}".audit_event WHERE outcome = 'denied' ORDER BY seq`)).rows
  } finally { await c.end() }
}

test('per-token 120/min: tool error, JSON-RPC refusals, other token unaffected', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const org = await createOrg(page, `NM ${unique()}`)
  await acmeWorkspace(page, org)
  const tokens: string[] = []
  for (let i = 0; i < 2; i++) tokens.push(await createToken(page, org, 'acme', { scopes: ['docket:read'], description: `t${i}` }))
  const ep = `/mcp/${org}/acme`
  const call = (t: string) => mcp(request, ep, t, 'tools/call', { name: 'docket_ontology', arguments: {} })

  // Scenario A: one token, calls 4 at a time until a 429.
  const t0 = tokens[0]!
  let n = 0; let first429: Awaited<ReturnType<typeof call>> | null = null; const statuses: Record<number, number> = {}
  while (!first429 && n < 400) {
    const batch = await Promise.all(Array.from({ length: 4 }, () => call(t0)))
    for (const r of batch) { n++; statuses[r.status()] = (statuses[r.status()] ?? 0) + 1; if (r.status() === 429 && !first429) first429 = r }
  }
  log(`A token-limit calls=${n} statuses=${JSON.stringify(statuses)}`)
  expect(first429).not.toBeNull()
  log(`A 429 headers retry-after=${first429!.headers()['retry-after']} expose=${first429!.headers()['access-control-expose-headers']} acao=${first429!.headers()['access-control-allow-origin']}`)
  log(`A 429 body=${JSON.stringify(await first429!.json())}`)
  expect(first429!.headers()['retry-after']).toBeTruthy()
  expect(first429!.headers()['access-control-expose-headers']).toContain('retry-after')
  // The bucket refills at 2 calls a second; drain it so the refusals below hold however slow the host is.
  await drainToken(org, 't0')
  // A raw JSON-RPC refusal for a non-tool method (tools/list) on the limited token
  const list = await mcp(request, ep, t0, 'tools/list')
  const listBody = await list.json()
  log(`A tools/list on limited token status=${list.status()} body=${JSON.stringify(listBody)}`)
  expect(list.status()).toBe(429)
  expect(listBody.error.code).toBe(-32029)
  // A malformed body on the limited token is also refused by the limit
  const bad = await request.post(ep, { headers: { authorization: `Bearer ${t0}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, data: 'not json{' })
  const badBody = await bad.json()
  log(`A malformed body on limited token status=${bad.status()} body=${JSON.stringify(badBody)}`)
  expect(bad.status()).toBe(429)
  expect(badBody).toMatchObject({ id: null, error: { code: -32029 } })
  // another token is unaffected
  const other = await call(tokens[1]!)
  log(`A other token status=${other.status()}`)
  expect(other.status()).toBe(200)

  const ev = await denied(org)
  const summary: Record<string, number> = {}
  for (const e of ev) { const k = `${e.action} ${JSON.stringify(e.target)}`; summary[k] = (summary[k] ?? 0) + 1 }
  log(`audit denied events: ${JSON.stringify(summary)}`)
  expect(Object.keys(summary).every((k) => k.endsWith('["rate-limit:calls-per-token"]'))).toBe(true)
})
