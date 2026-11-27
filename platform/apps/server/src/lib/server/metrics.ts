// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from 'node:http'

import { chainCheckStatus } from '@docket/platform-audit'
import type { Refusal } from '@docket/platform-limits'
import type { TenantRouter } from '@docket/platform-tenancy'
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client'

/**
 * Prometheus metrics (§15.2), served on their own port so the ingress never
 * exposes them: only the in-cluster VictoriaMetrics scrapes it. Labels carry
 * ids, never names or customer content.
 */
export const registry = new Registry()
collectDefaultMetrics({ register: registry })

const requests = new Histogram({
  name: 'docket_http_request_duration_seconds',
  help: 'HTTP requests by method, SvelteKit route id and status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5, 10],
  registers: [registry],
})

const rateLimited = new Counter({
  name: 'docket_rate_limited_total',
  help: 'Calls refused by a rate limit (§12), by the limit they hit',
  labelNames: ['scope', 'what'] as const,
  registers: [registry],
})

const collectErrors = new Counter({
  name: 'docket_metrics_collect_errors_total',
  help: 'Scrapes whose database-backed metrics could not be read',
  labelNames: ['collector'] as const,
  registers: [registry],
})

/** Where the database-backed gauges read from; null while the server is starting. */
let source: { router: TenantRouter } | null = null
let ready: () => boolean = () => false

export function observeRequest(method: string, route: string | null, status: number, seconds: number): void {
  requests.observe({ method, route: route ?? 'unmatched', status: String(status) }, seconds)
}

export function countRefusal(refusal: Refusal): void {
  rateLimited.inc({ scope: refusal.limit.scope, what: refusal.limit.what ?? 'calls' })
}

async function guarded(collector: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    collectErrors.inc({ collector })
    console.error(`metrics: ${collector}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

new Gauge({
  name: 'docket_ready',
  help: '1 when this replica is ready: Postgres reachable and the KEK loaded',
  registers: [registry],
  collect() {
    this.set(ready() ? 1 : 0)
  },
})

new Gauge({
  name: 'docket_orgs',
  help: 'Organisations by status',
  labelNames: ['status'] as const,
  registers: [registry],
  async collect() {
    this.reset()
    const router = source?.router
    if (!router) return
    await guarded('orgs', async () => {
      const rows = await router.withPlatform(async (tx) => {
        const { rows } = await tx.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM orgs GROUP BY status')
        return rows
      })
      for (const row of rows) this.set({ status: row.status }, row.n)
    })
  },
})

new Gauge({
  name: 'docket_index_behind_seconds',
  help: "Age of the oldest change to a workspace that the projections have not taken yet (its outbox's oldest unprocessed row); absent when up to date",
  labelNames: ['org', 'workspace'] as const,
  registers: [registry],
  async collect() {
    this.reset()
    const router = source?.router
    if (!router) return
    await guarded('index_behind', async () => {
      const orgs = await router.withPlatform(async (tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT id FROM orgs WHERE status = 'active' ORDER BY id")
        return rows.map((row) => row.id)
      })
      for (const org of orgs) {
        const rows = await router.withTenant(org, async (tx) => {
          const { rows } = await tx.query<{ workspace_id: string; age: number }>(
            `SELECT workspace_id, extract(epoch FROM now() - min(created_at))::float8 AS age
               FROM outbox WHERE processed_at IS NULL GROUP BY workspace_id`,
          )
          return rows
        })
        for (const row of rows) this.set({ org, workspace: row.workspace_id }, Math.max(0, Number(row.age)))
      }
    })
  },
})

new Gauge({
  name: 'docket_audit_chain_ok',
  help: "1 when an audit log's hash chain verified at its last check (§10), else 0; scope is `platform` or an org id",
  labelNames: ['scope'] as const,
  registers: [registry],
  async collect() {
    this.reset()
    const router = source?.router
    if (!router) return
    await guarded('audit_chain', async () => {
      for (const row of await router.withPlatform(chainCheckStatus)) this.set({ scope: row.scope }, row.ok ? 1 : 0)
    })
  },
})

new Gauge({
  name: 'docket_audit_chain_verified_timestamp_seconds',
  help: "When an audit log's hash chain was last checked",
  labelNames: ['scope'] as const,
  registers: [registry],
  async collect() {
    this.reset()
    const router = source?.router
    if (!router) return
    await guarded('audit_chain', async () => {
      for (const row of await router.withPlatform(chainCheckStatus)) {
        this.set({ scope: row.scope }, row.verifiedAt.getTime() / 1000)
      }
    })
  },
})

/** Points the database-backed gauges at the runtime once it is up. */
export function bindMetrics(options: { router: TenantRouter | null; ready: () => boolean }): void {
  source = options.router ? { router: options.router } : null
  ready = options.ready
}

/** Serves `GET /metrics` on its own port. */
export function startMetricsServer(port: number, host = '0.0.0.0'): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/metrics') {
      response.writeHead(404).end()
      return
    }
    registry
      .metrics()
      .then((text) => response.writeHead(200, { 'content-type': registry.contentType }).end(text))
      .catch((error: unknown) => {
        console.error(`metrics: ${error instanceof Error ? error.message : String(error)}`)
        response.writeHead(500).end()
      })
  })
  server.listen(port, host)
  server.unref()
  return server
}
