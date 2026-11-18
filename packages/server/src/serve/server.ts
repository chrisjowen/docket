import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Pool } from '../postgres/db.js'
import type { ServeBackend } from './backend.js'
import type { ServeConfig } from './config.js'
import { filesBackend } from './files.js'
import { serveHandler } from './http.js'
import { postgresBackend } from './postgres.js'

/** Listens on every interface: the server is reached through loopback by its own URL unless `publicUrl` says otherwise. */
const WILDCARD = new Set(['0.0.0.0', '::'])

export interface StartServeOptions {
  /** A pool to use instead of one made from `database.url` (tests). */
  pool?: Pool & { end(): Promise<void> }
  /** How often a files-backed server syncs files changed beside it; 0 never. Default 60 s. */
  syncIntervalMs?: number
  /** How often a Postgres-backed server sweeps the outbox without a notification. */
  loopIntervalMs?: number
  /** Resets every workspace's projections and projects everything again before answering. */
  rebuild?: boolean
}

export interface RunningServe {
  /** The URL it answers at: `publicUrl`, or the address it listens on. */
  url: string
  port: number
  backend: ServeBackend
  close(): Promise<void>
}

const listen = (server: Server, port: number, host: string): Promise<void> =>
  new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      server.off('error', fail)
      done()
    })
  })

/**
 * Starts `docket serve`: the backend the config names (a project's files,
 * or Postgres), then the HTTP server over it.
 */
export async function startServe(config: ServeConfig, options: StartServeOptions = {}): Promise<RunningServe> {
  const backend = config.database
    ? await postgresBackend(config, { ...(options.pool ? { pool: options.pool } : {}), ...(options.loopIntervalMs !== undefined ? { loopIntervalMs: options.loopIntervalMs } : {}) })
    : await filesBackend(config, { ...(options.syncIntervalMs !== undefined ? { syncIntervalMs: options.syncIntervalMs } : {}) })
  try {
    if (options.rebuild) for (const workspace of backend.workspaces) await backend.rebuild(workspace)
    let baseUrl = config.publicUrl ?? ''
    const handler = { current: null as ReturnType<typeof serveHandler> | null }
    const server = createServer((request, response) => {
      void (handler.current as ReturnType<typeof serveHandler>).handle(request, response)
    })
    await listen(server, config.listen.port, config.listen.host)
    const { port } = server.address() as AddressInfo
    if (!baseUrl) {
      const host = WILDCARD.has(config.listen.host) ? '127.0.0.1' : config.listen.host.includes(':') ? `[${config.listen.host}]` : config.listen.host
      baseUrl = `http://${host}:${port}`
    }
    handler.current = serveHandler({ config, backend, baseUrl })
    return {
      url: baseUrl,
      port,
      backend,
      async close() {
        await new Promise<void>((done, fail) => {
          server.closeAllConnections()
          server.close((cause) => (cause ? fail(cause) : done()))
        })
        await backend.close()
      }
    }
  } catch (cause) {
    await backend.close().catch(() => undefined)
    throw cause
  }
}
