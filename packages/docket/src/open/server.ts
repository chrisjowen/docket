import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { ConversationTurn } from '@docket/contracts'

import { AskCancelledError, AskRequestError, askProject } from '../query/ask.js'
import { EvidenceRequestError, readEvidenceBody, resolveReferences } from '../query/evidence.js'
import { takeSnapshot } from '../query/snapshot.js'
import { adaptersStatus } from '../query/status.js'
import type { AskBody, EvidenceResponse } from '../query/wire.js'
import { ask } from './ask.js'
import { chat } from './chat.js'
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

/**
 * All interfaces, so the UI is reachable from other machines on the network.
 * The API never changes the canonical files - its one write is the summary
 * cache - but it serves the repository's knowledge to whoever can reach it.
 */
const HOST = '0.0.0.0'

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

const askLimit = (raw: string | null): number => {
  if (raw === null) return DEFAULT_ASK_LIMIT
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(400, `limit must be a positive whole number, got "${raw}"`)
  }
  return Math.min(limit, MAX_ASK_LIMIT)
}

const question = (url: URL): string => {
  const query = url.searchParams.get('q')?.trim() ?? ''
  if (query === '') throw new HttpError(400, 'Ask something: the q parameter is empty.')
  return query
}

/** A JSON body is a question or a handful of references: anything larger is refused. */
const MAX_BODY_BYTES = 256 * 1024

/** A request id the client chose: short and printable, so it is safe to log and echo. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

const readJson = (request: IncomingMessage, response: ServerResponse): Promise<unknown> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.removeAllListeners('data')
        request.resume()
        response.setHeader('connection', 'close')
        fail(new HttpError(413, `The request body is larger than ${MAX_BODY_BYTES} bytes.`))
        return
      }
      chunks.push(chunk)
    })
    request.on('error', fail)
    request.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        fail(new HttpError(400, 'The request body is not JSON.'))
      }
    })
  })

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Checks a `POST /api/ask` body field by field, so a bad one says which. */
const askBody = (body: unknown): AskBody => {
  if (!isObject(body)) throw new HttpError(400, 'Send a JSON object: { "question": "..." }.')
  const { question, adapters, conversation, synthesis, timezone, requestId } = body
  if (typeof question !== 'string' || question.trim() === '') throw new HttpError(400, 'Ask something: question is empty.')
  if (adapters !== undefined && !(Array.isArray(adapters) && adapters.every((id) => typeof id === 'string'))) {
    throw new HttpError(400, 'adapters must be a list of adapter instance ids.')
  }
  const turns =
    conversation === undefined
      ? undefined
      : Array.isArray(conversation) &&
          conversation.every((turn) => isObject(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
        ? (conversation as ConversationTurn[]).map(({ role, content }) => ({ role, content }))
        : (() => {
            throw new HttpError(400, 'conversation must be a list of { role: "user" | "assistant", content } turns.')
          })()
  if (synthesis !== undefined && typeof synthesis !== 'boolean') throw new HttpError(400, 'synthesis must be true or false.')
  if (timezone !== undefined && typeof timezone !== 'string') throw new HttpError(400, 'timezone must be an IANA time zone name.')
  if (requestId !== undefined && (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))) {
    throw new HttpError(400, 'requestId must be 1 to 128 letters, digits, ".", "_", ":" or "-".')
  }
  return {
    question,
    ...(adapters !== undefined ? { adapters: adapters as string[] } : {}),
    ...(turns !== undefined ? { conversation: turns } : {}),
    ...(synthesis !== undefined ? { synthesis } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(requestId !== undefined ? { requestId } : {})
  }
}

/** Questions being answered, by request id, so a client can cancel one by id. */
type InFlight = Map<string, AbortController>

/**
 * `POST /api/ask`: one question through the shared coordinator. The request
 * id - the body's, or one made here - comes back in `x-request-id` and in the
 * answer. The question is cancelled when the client goes away or sends
 * `DELETE /api/ask/<id>`: adapters still answering are closed and the model
 * stopped.
 */
const coordinatedAsk = async (
  request: IncomingMessage,
  response: ServerResponse,
  cwd: string,
  inFlight: InFlight
): Promise<unknown> => {
  const body = askBody(await readJson(request, response))
  const requestId = body.requestId ?? randomUUID()
  if (inFlight.has(requestId)) throw new HttpError(409, `A question with request id "${requestId}" is already being answered.`)
  response.setHeader('x-request-id', requestId)

  const controller = new AbortController()
  inFlight.set(requestId, controller)
  const gone = (): void => {
    if (!response.writableFinished) controller.abort()
  }
  response.once('close', gone)
  try {
    const { answer } = await askProject(cwd, { ...body, requestId, signal: controller.signal })
    return answer
  } catch (cause) {
    if (cause instanceof AskRequestError) throw new HttpError(400, cause.message)
    if (cause instanceof AskCancelledError) throw new HttpError(409, `Question ${requestId} was cancelled.`)
    throw cause
  } finally {
    inFlight.delete(requestId)
  }
}

const api = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  cwd: string,
  inFlight: InFlight
): Promise<unknown> => {
  const method = request.method ?? 'GET'
  const allow = (...methods: string[]): void => {
    if (!methods.includes(method)) {
      response.setHeader('allow', methods.join(', '))
      throw new HttpError(405, `${url.pathname} answers ${methods.join(' and ')}, not ${method}.`)
    }
  }

  const cancel = /^\/api\/ask\/([^/]+)$/.exec(url.pathname)
  if (cancel) {
    allow('DELETE')
    const id = decodeURIComponent(cancel[1] as string)
    const controller = inFlight.get(id)
    if (!controller) throw new HttpError(404, `No question with request id "${id}" is being answered.`)
    controller.abort()
    return { requestId: id, cancelled: true }
  }

  switch (url.pathname) {
    case '/api/graph':
      allow('GET', 'HEAD')
      return readGraph(cwd)
    case '/api/ask':
      allow('GET', 'HEAD', 'POST')
      // GET is the legacy search answer; POST asks the coordinator.
      if (method === 'POST') return coordinatedAsk(request, response, cwd, inFlight)
      return ask(cwd, question(url), askLimit(url.searchParams.get('limit')))
    case '/api/chat':
      allow('GET', 'HEAD')
      return chat(cwd, question(url), askLimit(url.searchParams.get('limit')))
    case '/api/adapters':
      allow('GET', 'HEAD')
      return adaptersStatus(cwd)
    case '/api/evidence': {
      allow('POST')
      let references
      try {
        references = readEvidenceBody(await readJson(request, response))
      } catch (cause) {
        if (cause instanceof EvidenceRequestError) throw new HttpError(400, cause.message)
        throw cause
      }
      const resolved: EvidenceResponse = { references: resolveReferences(await takeSnapshot(cwd), references) }
      return resolved
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
  options: { cwd: string; uiDir: string; inFlight: InFlight }
): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      const body = await api(request, response, url, options.cwd, options.inFlight)
      if (!response.destroyed) sendJson(response, 200, body)
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, status, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
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
 * Serves the built UI and a JSON API over the repository: the graph from the
 * canonical files; questions put to the adapters through the shared
 * coordinator (`POST /api/ask`), optionally summarized by a model; adapter
 * status (`GET /api/adapters`); canonical references resolved for the
 * evidence inspector (`POST /api/evidence`); and the legacy `GET /api/ask`
 * and `GET /api/chat`, translated from the coordinator's answers. Every
 * request re-reads the files, so a refresh shows edits made since. Nothing it
 * does changes the files; summaries are kept in the docket's disposable
 * `.cache/`.
 */
export const startUiServer = async (options: UiServerOptions): Promise<UiServer> => {
  const context = { cwd: options.cwd, uiDir: resolve(options.uiDir), inFlight: new Map<string, AbortController>() }
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
