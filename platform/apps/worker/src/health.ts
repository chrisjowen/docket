// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from 'node:http'

/** What `/readyz` checks: that Postgres answers. */
export interface Pingable {
  query(sql: string): Promise<unknown>
}

/**
 * The worker's probe port: `/healthz` and `/readyz` for the kubelet, and
 * nothing else. It takes no tenant and no credentials, so it serves no
 * tenant data; questions go through the query service, which the API
 * reaches with the tenant from the authenticated URL path (§3, §9).
 */
export function healthServer(pool: Pingable): Server {
  return createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200).end('ok')
      return
    }
    if (req.url === '/readyz') {
      pool
        .query('select 1')
        .then(() => res.writeHead(200).end('ready'))
        .catch((error: unknown) => res.writeHead(503).end(`postgres: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    res.writeHead(404).end()
  })
}
