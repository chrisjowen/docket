// SPDX-License-Identifier: AGPL-3.0-only
/* global __ENV, __VU, open */
// Load test (plan M9 step 2): 20 concurrent MCP searches across 4 orgs for
// 30 minutes; p95 under 800 ms, against the MCP endpoint (POST /mcp/<org>/<ws>),
// rate limits and all (§12). Watch Grafana's "Memory by pod" and "Container
// restarts" (or the PodOOMKilled alert) meanwhile: no OOM kills.
//
//   k6 run tests/load/mcp-search.k6.js \
//     -e BASE_URL=http://127.0.0.1:4470 \
//     -e TARGETS_FILE=/path/to/targets.json
//
// The targets file (or -e TARGETS='[...]') lists one API token per virtual
// user, [{"org":"acme","ws":"platform","token":"dkt_live_..."}, ...]: 20 for
// the plan's run, 5 in each of 4 orgs, each with docket:read on its workspace.
// Keep it out of the repo and off a shared terminal. Against a local build
// (tests/e2e/serve.mjs with the worker), tests/load/seed.mjs makes the orgs,
// workspaces and tokens and writes that file. Each virtual user initializes
// once and searches its workspace about 1.4 times a second: under the
// per-token limit (120 a minute) and, at 5 users an org, under the per-org one
// (600 a minute, §12), so a 429 counts as a failure here.
//
// Shorter runs: -e DURATION=2m. Fewer users: -e VUS=4. Against a single org
// (production has one), 20 users at the default pace pass its 600 calls a
// minute: slow each user's searches with -e PACE=2.5 (seconds per search).
import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:4470').replace(/\/$/, '')
const TARGETS = JSON.parse(__ENV.TARGETS_FILE ? open(__ENV.TARGETS_FILE) : __ENV.TARGETS || '[]')
const QUERIES = ['orders', 'payments service', 'who owns checkout', 'postgres', 'pci scope', 'eu data residency']
const PROTOCOL = '2025-11-25'
/** Seconds each search iteration takes at least: by default about 1.4 calls a second per token. */
const PACE_SECONDS = Number(__ENV.PACE || 0.7)
const VUS = Number(__ENV.VUS || 20)

const searchTime = new Trend('mcp_search_duration', true)
const toolErrors = new Counter('mcp_tool_errors')
const limited = new Counter('mcp_rate_limited')

export const options = {
  scenarios: {
    searches: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '30m',
    },
  },
  thresholds: {
    mcp_search_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    mcp_tool_errors: ['count<1'],
    mcp_rate_limited: ['count<1'],
  },
}

export function setup() {
  if (TARGETS.length < 1) fail('set TARGETS_FILE (or TARGETS) to a JSON list of {org, ws, token}')
  const orgs = new Set(TARGETS.map((t) => t.org))
  if (orgs.size < 4) console.warn(`TARGETS spans ${orgs.size} org(s); the plan's run uses 4`)
  if (TARGETS.length < VUS) {
    console.warn(`${TARGETS.length} token(s) for ${VUS} users: users share tokens and may hit the per-token limit`)
  }
  return { targets: TARGETS }
}

/** One JSON-RPC POST; answers the parsed message, whether sent as JSON or as one SSE event. */
function rpc(target, session, body) {
  const headers = {
    authorization: `Bearer ${target.token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL,
  }
  if (session) headers['mcp-session-id'] = session
  const response = http.post(`${BASE_URL}/mcp/${target.org}/${target.ws}`, JSON.stringify(body), {
    headers,
    tags: { org: target.org, method: body.method },
  })
  if (response.status === 429) limited.add(1)
  let message = null
  const type = response.headers['Content-Type'] || ''
  if (type.includes('text/event-stream')) {
    const data = String(response.body)
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop()
    message = data ? JSON.parse(data) : null
  } else if (response.body) {
    try {
      message = JSON.parse(String(response.body))
    } catch {
      message = null
    }
  }
  return { response, message }
}

let initialized = false
// Docket Cloud keeps no sessions (one JSON-RPC message per POST); a server that hands out an id gets it back.
let session = null
let target = null
let id = 0

export default function (data) {
  if (!target) target = data.targets[(__VU - 1) % data.targets.length]
  if (!initialized) {
    const init = rpc(target, null, {
      jsonrpc: '2.0',
      id: ++id,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'docket-load-test', version: '1' } },
    })
    if (!check(init.response, { 'initialize 200': (r) => r.status === 200 })) return
    session = init.response.headers['Mcp-Session-Id'] || null
    initialized = true
    rpc(target, session, { jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)]
  const started = Date.now()
  const { response, message } = rpc(target, session, {
    jsonrpc: '2.0',
    id: ++id,
    method: 'tools/call',
    params: { name: 'docket_search', arguments: { query, limit: 10 } },
  })
  const elapsed = (Date.now() - started) / 1000
  searchTime.add(elapsed * 1000, { org: target.org })
  const ok = check(response, { 'search 200': (r) => r.status === 200 })
  if (ok && (!message || message.error || message.result?.isError)) toolErrors.add(1)
  if (elapsed < PACE_SECONDS) sleep(PACE_SECONDS - elapsed)
}
