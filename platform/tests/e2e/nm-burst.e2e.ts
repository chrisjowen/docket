// SPDX-License-Identifier: AGPL-3.0-only
import { test } from '@playwright/test'
import { acmeWorkspace, createOrg, createToken, mcp, signIn, unique } from './helpers'

test('burst of N concurrent MCP calls on one token', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, 'alice')
  const org = await createOrg(page, `Burst ${unique()}`)
  await acmeWorkspace(page, org)
  const token = await createToken(page, org, 'acme', { scopes: ['docket:read'] })
  const n = Number(process.env.BURST ?? 120)
  const started = Date.now()
  const res = await Promise.all(Array.from({ length: n }, () => mcp(request, `/mcp/${org}/acme`, token, 'tools/call', { name: 'docket_ontology', arguments: {} })))
  const counts: Record<number, number> = {}
  for (const r of res) counts[r.status()] = (counts[r.status()] ?? 0) + 1
  console.log(`BURST n=${n} ms=${Date.now() - started} statuses=${JSON.stringify(counts)}`)
})
