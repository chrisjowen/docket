#!/usr/bin/env node
// docket serve's Phase 3 gates against a running server, over HTTP only: the
// same checks packages/server/src/serve/gates.test.ts makes in-process, for a
// server deployed with Compose or Helm. No dependencies beyond Node 22.
//
//   DOCKET_E2E_URL=http://127.0.0.1:4390 DOCKET_E2E_WORKSPACE=docket \
//   DOCKET_E2E_OWNER_TOKEN=dks_… DOCKET_E2E_EDITOR_TOKEN=dks_… \
//   node deploy/test/e2e.mjs
//
// DOCKET_E2E_STORE (files or postgres) is what /healthz should report.
// DOCKET_E2E_DROP_INDEX, if set, is a shell command that deletes the
// workspace's index, run before the rebuild is checked. The tokens are read
// from the environment, never the command line, which other users can see.

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const env = (name, fallback) => {
  const value = process.env[name] || fallback
  if (value === undefined) throw new Error(`Set ${name}.`)
  return value
}
const base = env('DOCKET_E2E_URL').replace(/\/+$/, '')
const workspace = env('DOCKET_E2E_WORKSPACE', 'docket')
const owner = env('DOCKET_E2E_OWNER_TOKEN')
const editor = env('DOCKET_E2E_EDITOR_TOKEN')
const store = process.env.DOCKET_E2E_STORE
const dropIndex = process.env.DOCKET_E2E_DROP_INDEX
const mcpUrl = `${base}/mcp/${workspace}`

const TOOLS = [
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
  'docket_publish_ontology_change'
]
const EVIDENCE = [{ source: 'human', note: 'Said in planning.' }]
// Names of this run's own, so a second run against the same server does not collide with the first.
const run = Array.from(randomBytes(6), (byte) => String.fromCharCode(97 + (byte % 26))).join('')
const squad = `squad${run}`
const team = `team.payments-${run}`
const service = `service.ledger-${run}`

let failures = 0
let id = 1
const check = (ok, what, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : `\n    ${detail}`}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpc(token, method, params = {}) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params })
  })
  const text = await response.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: response.status, body }
}
async function call(token, name, args) {
  const { status, body } = await rpc(token, 'tools/call', { name, arguments: args })
  const result = body.result
  return { status, result, text: result?.content?.[0]?.text ?? JSON.stringify(body.error ?? body) }
}
/** The ids docket_search finds for `query`, waiting up to a minute for the projections to catch up. */
async function found(query, wanted, present = true) {
  let ids = []
  for (let attempt = 0; attempt < 60; attempt++) {
    const answer = await call(editor, 'docket_search', { query, include: ['facts'] })
    ids = (answer.result?.structuredContent?.matches ?? []).map((match) => match.id)
    if (ids.includes(wanted) === present) return true
    await sleep(1000)
  }
  return false
}

const health = await (await fetch(`${base}/healthz`)).json()
check(health.status === 'ok' && (!store || health.store === store), `/healthz is ok${store ? ` over ${store}` : ''}`, JSON.stringify(health))
const ready = await fetch(`${base}/readyz`)
check(ready.status === 200, '/readyz is ready', `${ready.status}`)
const anonymous = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
check(anonymous.status === 401 && /^Bearer resource_metadata=/.test(anonymous.headers.get('www-authenticate') ?? ''), 'a call without a token is refused with a Bearer challenge', `${anonymous.status}`)

const ownerTools = (await rpc(owner, 'tools/list')).body.result?.tools?.map((tool) => tool.name) ?? []
check(JSON.stringify(ownerTools) === JSON.stringify(TOOLS), "the owner is offered Docket's whole MCP surface, eleven tools", ownerTools.join(', '))
const editorTools = (await rpc(editor, 'tools/list')).body.result?.tools?.map((tool) => tool.name) ?? []
check(JSON.stringify(editorTools) === JSON.stringify(TOOLS.filter((name) => name !== 'docket_publish_ontology_change')), 'the editor is offered every tool but publishing', editorTools.join(', '))

for (const [resource, type, title, body] of [
  [team, 'team', 'Payments', 'The payments team owns checkout money movement.'],
  [service, 'service', 'Ledger', `Keeps the double-entry books ${run} for every order.`]
]) {
  const written = await call(owner, 'docket_remember', { id: resource, type, title, body, evidence: EVIDENCE })
  check(written.status === 200 && !written.result?.isError, `the owner remembers ${resource}`, written.text)
}
const evidence = await call(editor, 'docket_add_evidence', { id: service, evidence: [{ source: 'human', note: 'The editor saw it too.' }] })
check(evidence.result?.structuredContent?.ok === true, 'the editor adds evidence to it', evidence.text)
check(await found(`double-entry books ${run} ledger`, service), "the editor's search finds what the owner remembered")

const patch = `resourceTypes:\n  ${squad}:\n    description: A squad.\n`
const proposed = await call(editor, 'docket_propose_ontology_change', { patch, message: 'Squads.' })
check(proposed.result?.structuredContent?.schema === 'docket-ontology-proposal.v1', 'the editor proposes an ontology change as a draft', proposed.text)
const head = (await call(owner, 'docket_ontology', {})).result?.structuredContent?.version
const published = await call(owner, 'docket_publish_ontology_change', {
  patch,
  migration: [{ op: 'mapType', from: 'team', to: squad }],
  acceptNarrowing: true,
  expectedHead: head,
  message: 'Teams are squads now.'
})
const answer = published.result?.structuredContent
check(
  !published.result?.isError && answer?.version === head + 1 && (answer?.rewritten ?? []).some((each) => each.resourceId === team),
  'the owner publishes it with a migration that rewrites the documents',
  published.text
)
const payments = await call(editor, 'docket_get', { id: team })
check(payments.result?.structuredContent?.resource?.type === squad, `${team} is a ${squad} now`, payments.text)

const editorPublish = await call(editor, 'docket_publish_ontology_change', { patch: `resourceTypes:\n  queue${run}:\n    description: A queue.\n` })
check(editorPublish.status === 403, "the editor's publish is refused", `${editorPublish.status} ${editorPublish.text}`)
const stale = await call(owner, 'docket_publish_ontology_change', { patch: `resourceTypes:\n  queue${run}:\n    description: A queue.\n`, expectedHead: head })
check(stale.result?.isError === true && /Nothing was published/.test(stale.text), 'a publish against a stale expectedHead is refused', stale.text)

const inUrl = await fetch(`${mcpUrl}?access_token=${owner}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check(inUrl.status === 400, 'a token in the URL is refused', `${inUrl.status}`)

if (dropIndex) {
  execSync(dropIndex, { stdio: 'inherit' })
  check(await found(`double-entry books ${run} ledger`, service, false), 'with the index dropped, search no longer finds it')
}
const refused = await fetch(`${base}/api/w/${workspace}/rebuild`, { method: 'POST', headers: { authorization: `Bearer ${editor}` } })
check(refused.status === 403, "the editor's rebuild is refused", `${refused.status}`)
const rebuilt = await fetch(`${base}/api/w/${workspace}/rebuild`, { method: 'POST', headers: { authorization: `Bearer ${owner}` } })
check(rebuilt.status === 200, "the owner's rebuild projects everything again", `${rebuilt.status} ${await rebuilt.text()}`)
check(await found(`double-entry books ${run} ledger`, service), 'search finds it again after the rebuild')

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
