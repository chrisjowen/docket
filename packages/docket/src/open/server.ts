import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { ask } from './ask.js'
import { readGraph } from './graph.js'

/** Tried first so the UI keeps one address between runs; any free port when it is taken. */
export const DEFAULT_PORT = 4380

export const DEFAULT_ASK_LIMIT = 10
const MAX_ASK_LIMIT = 50

export interface UiServerOptions {
  /** Directory to resolve `.docket.yaml` from on every request. */
  cwd: string
  /** The built web UI: `index.html` and its assets. */
  uiDir: string
  /** Exact port, failing when taken. Omitted: `DEFAULT_PORT`, else any free one. */
  port?: number | undefined
}

export interface UiServer {
  url: string
  port: number
  close(): Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

/** Loopback only: the UI serves the repository's knowledge to whoever can reach it. */
const HOST = '127.0.0.1'

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1'])

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    'content-type': MIME['.json'] as string,
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

/**
 * A page on another site can make the browser send requests here, and DNS
 * rebinding can make them look same-origin. Answering only requests addressed
 * to a loopback name stops both.
 */
const addressedToUs = (request: IncomingMessage): boolean => {
  const header = request.headers.host
  if (!header) return false
  let hostname: string
  try {
    hostname = new URL(`http://${header}`).hostname
  } catch {
    return false
  }
  return LOOPBACK_NAMES.has(hostname)
}

const askLimit = (raw: string | null): number => {
  if (raw === null) return DEFAULT_ASK_LIMIT
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(400, `limit must be a positive whole number, got "${raw}"`)
  }
  return Math.min(limit, MAX_ASK_LIMIT)
}

const api = async (url: URL, cwd: string): Promise<unknown> => {
  switch (url.pathname) {
    case '/api/graph':
      return readGraph(cwd)
    case '/api/ask': {
      const query = url.searchParams.get('q')?.trim() ?? ''
      if (query === '') throw new HttpError(400, 'Ask something: the q parameter is empty.')
      return ask(cwd, query, askLimit(url.searchParams.get('limit')))
    }
    default:
      throw new HttpError(404, `No API at ${url.pathname}`)
  }
}

/** A file under `uiDir`, never outside it, or null. */
const staticFile = async (uiDir: string, pathname: string): Promise<string | null> => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = resolve(uiDir, `.${normalize(`/${decoded}`)}`)
  if (file !== uiDir && !file.startsWith(`${uiDir}${sep}`)) return null
  try {
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

const serveFile = (response: ServerResponse, file: string, head: boolean): void => {
  // SvelteKit content-hashes everything under _app/immutable.
  const immutable = file.includes(`${sep}_app${sep}immutable${sep}`)
  response.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff'
  })
  if (head) response.end()
  else createReadStream(file).pipe(response)
}

const handle = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: { cwd: string; uiDir: string }
): Promise<void> => {
  if (!addressedToUs(request)) {
    sendJson(response, 403, { error: 'docket open only answers requests addressed to localhost.' })
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      sendJson(response, 200, await api(url, options.cwd))
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500
      sendJson(response, status, { error: cause instanceof Error ? cause.message : String(cause) })
    }
    return
  }

  const head = request.method === 'HEAD'
  const file = await staticFile(options.uiDir, url.pathname)
  if (file) {
    serveFile(response, file, head)
    return
  }
  // A single-page app: any other route is the app's, unless it names an asset.
  // Entity ids hold dots, so "has an extension" would wrongly 404 them.
  const asset = url.pathname.startsWith('/_app/') || extname(url.pathname) in MIME
  const index = asset ? null : await staticFile(options.uiDir, '/index.html')
  if (index) {
    serveFile(response, index, head)
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((done, fail) => {
    const onError = (cause: Error): void => {
      server.off('listening', onListening)
      fail(cause)
    }
    const onListening = (): void => {
      server.off('error', onError)
      done()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })

/**
 * Serves the built UI and a read-only JSON API over the repository: the graph
 * from the canonical files, and answers from the same search agents use. Every
 * request re-reads the files, so a refresh shows edits made since.
 */
export const startUiServer = async (options: UiServerOptions): Promise<UiServer> => {
  const context = { cwd: options.cwd, uiDir: resolve(options.uiDir) }
  const server = createServer((request, response) => {
    handle(request, response, context).catch((cause: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      } else {
        response.destroy()
      }
    })
  })

  if (options.port !== undefined) {
    await listen(server, options.port)
  } else {
    try {
      await listen(server, DEFAULT_PORT)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw cause
      await listen(server, 0)
    }
  }

  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise((done, fail) => {
        server.closeAllConnections()
        server.close((cause) => (cause ? fail(cause) : done()))
      })
  }
}

/** Where the build puts the UI: `dist/ui`, next to `dist/open`. */
export const defaultUiDir = (): string => join(import.meta.dirname, '..', 'ui')
