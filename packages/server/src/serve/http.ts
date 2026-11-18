import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { effectiveScopes, checkScope } from '../auth/effective.js'
import { SCOPES, type Scope } from '../auth/scopes.js'
import { CORS_HEADERS, MAX_BODY_BYTES, bearerChallenge, credentialInUrl, handleMcp } from '../mcp/handler.js'
import { WRITE_TOOL_NAMES } from '../mcp/tools/index.js'
import type { AuditOutcome } from '../ports.js'
import { fileAuditLog, type ServeBackend, type ServedWorkspace } from './backend.js'
import type { ServeConfig } from './config.js'
import { TOKEN_PREFIX, tokenAuth, type ServeResource, type TokenPrincipal } from './tokens.js'

/*
 * `docket serve`'s HTTP surface, over a backend:
 *
 *   GET  /healthz, /readyz                the process is up; its store answers
 *   POST /mcp/{workspace}                 the workspace's MCP endpoint (Streamable HTTP, JSON answers)
 *   POST /mcp                             the same, when the server serves one workspace
 *   POST /mcp/{org}/{workspace}           the same, at the path Docket Cloud's links use
 *   /api/w/{workspace}/{me,documents,documents/push}
 *   /api/o/{org}/w/{workspace}/...        the documents API `docket cloud link|push|pull|status` call
 *   POST /api/w/{workspace}/rebuild       an owner or admin rebuilds the workspace's projections
 *   /login, /logout, /, /api/...          docket open's page and reads, after signing in with a token
 *
 * Every credential is a bearer token in the Authorization header - never a
 * URL, which ends up in logs. The org in Docket Cloud's paths is ignored:
 * this server has one tenant.
 */

const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

/** What `GET /healthz` names itself. */
export const SERVICE = 'docket-serve'

/** The session cookie the page signs in with: an opaque id, never the token. */
export const SESSION_COOKIE = 'docket_session'
const SESSION_MS = 12 * 60 * 60 * 1000

/** Refused credentials from one address before it is turned away for a minute. */
const REFUSALS_PER_MINUTE = 30

interface Session {
  token: string
  slug: string
  expires: number
}

export interface ServeHandlerOptions {
  config: ServeConfig
  backend: ServeBackend
  /** The URL clients reach the server at, without a trailing slash. */
  baseUrl: string
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(body))
}

const problem = (response: ServerResponse, status: number, error: string, description: string, headers: Record<string, string> = {}): void =>
  json(response, status, { error, error_description: description }, headers)

/** The request's body, up to the MCP endpoint's cap; null when it is larger. */
const bodyOf = (request: IncomingMessage): Promise<Buffer | null> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) over = true
      else chunks.push(chunk)
    })
    request.on('error', fail)
    request.on('end', () => done(over ? null : Buffer.concat(chunks)))
  })

const cookieOf = (request: IncomingMessage, name: string): string | null => {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/** Whether a body is a call to one of the write tools. */
const writeCall = (body: Buffer | null): boolean => {
  try {
    const message = JSON.parse(body?.toString('utf8') ?? 'null') as { method?: unknown; params?: { name?: unknown } } | null
    return message?.method === 'tools/call' && (WRITE_TOOL_NAMES as readonly unknown[]).includes(message.params?.name)
  } catch {
    return false
  }
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** The sign-in page: a token, and which workspace to browse when there are several. */
function loginPage(workspaces: readonly ServedWorkspace[], error?: string): string {
  const choose =
    workspaces.length > 1
      ? `<label>Workspace <select name="workspace">${workspaces.map((each) => `<option>${escapeHtml(each.slug)}</option>`).join('')}</select></label>`
      : `<input type="hidden" name="workspace" value="${escapeHtml(workspaces[0]?.slug ?? '')}">`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Docket</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#1d1d1b}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 3px #0002;display:grid;gap:1rem;width:min(26rem,calc(100vw - 2rem))}
h1{font-size:1.25rem;margin:0}label{display:grid;gap:.25rem;font-size:.9rem}input,select,button{font:inherit;padding:.5rem .75rem;border:1px solid #ccc;border-radius:8px}
button{background:#1d1d1b;color:#fff;border:0;cursor:pointer}.error{color:#a12a1a;margin:0}p{margin:0;color:#555;font-size:.9rem}
@media (prefers-color-scheme:dark){body{background:#161615;color:#eee}form{background:#22221f}input,select{background:#161615;color:#eee;border-color:#444}button{background:#eee;color:#161615}p{color:#aaa}}
</style></head><body><form method="post" action="/login"><h1>Sign in to Docket</h1>
<p>Paste a token from <code>docket serve token create</code>. It is checked here and never kept in the browser.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<label>Token <input name="token" type="password" autocomplete="off" required autofocus></label>${choose}
<button type="submit">Sign in</button></form></body></html>`
}

/** The request handler: one function for the whole server. */
export function serveHandler(options: ServeHandlerOptions): {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>
} {
  const { config, backend, baseUrl } = options
  const auth = tokenAuth(config)
  const audit = fileAuditLog(`${config.dataDir}/audit.jsonl`, (id) => backend.workspaces.find((each) => each.id === id)?.slug ?? id)
  const sessions = new Map<string, Session>()
  const refusals = new Map<string, { count: number; since: number }>()
  const views = new Map(backend.workspaces.map((workspace) => [workspace.slug, backend.readViews(workspace)]))

  const workspaceOf = (slug: string | undefined): ServedWorkspace | null => backend.workspaces.find((each) => each.slug === slug) ?? null
  const resourceOf = (workspace: ServedWorkspace, url: string): ServeResource => ({ url, workspaceId: workspace.id, slug: workspace.slug })
  const addressOf = (request: IncomingMessage) => request.socket.remoteAddress ?? null
  const refused = (ip: string | null) => {
    const key = ip ?? 'unknown'
    const now = Date.now()
    const entry = refusals.get(key)
    return entry !== undefined && now - entry.since < 60_000 && entry.count >= REFUSALS_PER_MINUTE
  }
  const refuse = async (request: IncomingMessage, action: string, outcome: AuditOutcome) => {
    const key = addressOf(request) ?? 'unknown'
    const now = Date.now()
    const entry = refusals.get(key)
    refusals.set(key, entry && now - entry.since < 60_000 ? { count: entry.count + 1, since: entry.since } : { count: 1, since: now })
    await audit.line({
      at: new Date().toISOString(),
      workspace: null,
      actor: 'anonymous',
      action,
      outcome,
      target: [],
      latencyMs: 0,
      requestId: randomUUID(),
      ip: addressOf(request),
      userAgent: request.headers['user-agent'] ?? null
    })
  }

  async function mcp(request: IncomingMessage, response: ServerResponse, workspace: ServedWorkspace | null, resourceUrl: string): Promise<void> {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { ...CORS_HEADERS, allow: 'POST, OPTIONS', 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'This MCP endpoint answers POST: one JSON-RPC message (Streamable HTTP), answered as JSON.' }))
      return
    }
    const body = await bodyOf(request)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value)
      else if (Array.isArray(value)) headers.set(name, value.join(', '))
    }
    const fetchRequest = new Request(new URL(request.url ?? '/', baseUrl), {
      method: 'POST',
      headers,
      // Over the cap: a body the handler measures as too large.
      body: body ?? Buffer.alloc(MAX_BODY_BYTES + 1, 32)
    })
    const parts = workspace ? backend.mcp(workspace) : null
    const answer = await handleMcp<TokenPrincipal, ServeResource>(fetchRequest, {
      resourceUrl,
      resource: workspace ? resourceOf(workspace, resourceUrl) : null,
      authenticator: auth.authenticator,
      authorizer: auth.authorizer,
      audit: () => audit,
      store: (principal) => (parts as NonNullable<typeof parts>).store(principal),
      query: (principal) => (parts as NonNullable<typeof parts>).query(principal),
      ...(parts?.tools ? { tools: parts.tools } : {}),
      ...(parts?.source ? { source: parts.source } : {}),
      ...(parts?.modelGate ? { modelGate: parts.modelGate } : {}),
      links: () => ({ viewer: `${baseUrl}/`, ontologyHistory: `${baseUrl}/` }),
      writerLabel: async (principal) => `${principal.token} via docket serve`,
      refusedCredentials: {
        blocked: () => (refused(addressOf(request)) ? new Response(JSON.stringify({ error: 'rate_limited', error_description: 'Too many refused credentials from this address; try again in a minute.' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }) : null),
        record: (action, outcome) => refuse(request, action, outcome)
      },
      tokenPrefixes: [TOKEN_PREFIX],
      requestId: randomUUID(),
      ip: addressOf(request),
      userAgent: request.headers['user-agent'] ?? null,
      serverInfo: { name: SERVICE, title: 'Docket', version: VERSION },
      onError: (cause) => console.error(`docket serve: an MCP call failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
    })
    // A write brings the projections up to date in the background.
    if (workspace && answer.status === 200 && writeCall(body)) backend.written(workspace)
    const out: Record<string, string> = {}
    answer.headers.forEach((value, name) => {
      out[name] = value
    })
    response.writeHead(answer.status, out)
    response.end(Buffer.from(await answer.arrayBuffer()))
  }

  /** The documents API's pipeline: a bearer for the workspace, its effective scopes, one audit line. */
  async function cli(request: IncomingMessage, response: ServerResponse, url: URL, workspace: ServedWorkspace | null, route: string): Promise<void> {
    const resourceUrl = `${baseUrl}/mcp/${workspace?.slug ?? ''}`
    const challenge = (refusal?: Parameters<typeof bearerChallenge>[1]) => ({ 'www-authenticate': bearerChallenge(resourceUrl, refusal) })
    if (refused(addressOf(request))) return problem(response, 429, 'rate_limited', 'Too many refused credentials from this address; try again in a minute.', { 'retry-after': '60' })
    if (credentialInUrl(url, [TOKEN_PREFIX])) {
      await refuse(request, 'cli.auth', 'invalid')
      return problem(response, 400, 'invalid_request', 'Send the token in the Authorization header, never in the URL.')
    }
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1] ?? null
    if (!bearer) return problem(response, 401, 'invalid_token', 'Send Authorization: Bearer <token>.', challenge())
    const principal = workspace ? await auth.authenticator.resolve(bearer, resourceOf(workspace, resourceUrl)) : null
    if (!workspace || !principal) {
      await refuse(request, 'cli.auth', 'denied')
      if (!workspace && (await auth.lookup(bearer))) return problem(response, 404, 'not_found', 'There is no such workspace on this server.')
      return problem(response, 401, 'invalid_token', 'This token is not valid for this workspace.', challenge({ error: 'invalid_token', description: 'This token is not valid for this workspace.' }))
    }
    const started = performance.now()
    const requestId = randomUUID()
    const effective = await effectiveScopes(principal, auth.authorizer)
    const role = await auth.authorizer.role(principal)
    const action = `cli.${route.replace('/', '.')}`
    const done = (outcome: AuditOutcome, target: string[] = []) =>
      audit.record(null, { workspaceId: workspace.id, actor: principal.actor, action, outcome, target, latencyMs: Math.round(performance.now() - started), requestId, ip: addressOf(request), userAgent: request.headers['user-agent'] ?? null })
    if (effective.length === 0 || role === null) {
      await done('denied')
      return problem(response, 401, 'invalid_token', 'This token no longer grants anything on this server.', challenge({ error: 'invalid_token' }))
    }
    const needs = (scope: Scope): boolean => {
      const refusal = checkScope(effective, scope)
      if (!refusal) return true
      void done('denied')
      const scopeOf = 'scope' in refusal ? refusal.scope : undefined
      problem(response, refusal.status, refusal.error, refusal.description, challenge({ error: refusal.error, description: refusal.description, ...(scopeOf ? { scope: scopeOf } : {}) }))
      return false
    }
    const method = request.method ?? 'GET'
    const only = (allowed: string): boolean => {
      if (method === allowed) return true
      problem(response, 405, 'invalid_request', `${url.pathname} answers ${allowed}.`, { allow: allowed })
      return false
    }

    if (route === 'me') {
      if (!only('GET')) return
      await done('ok')
      return json(response, 200, {
        login: principal.token,
        org: 'self',
        workspace: workspace.slug,
        role,
        scopes: effective,
        token: { kind: 'api', id: principal.token, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }
      })
    }

    if (route === 'documents') {
      if (!only('GET') || !needs('docket:read')) return
      const query = url.searchParams
      const origin = query.get('origin')
      if (origin !== 'cli' && origin !== 'cloud') return problem(response, 400, 'invalid_request', 'origin is cli or cloud.')
      const originRef = query.get('originRef')
      if ((origin === 'cli') !== (originRef !== null)) return problem(response, 400, 'invalid_request', 'originRef is the checkout, with origin=cli only.')
      const include = query.get('include')
      if (include !== null && (include !== 'raw' || origin !== 'cloud')) return problem(response, 400, 'invalid_request', 'include is raw with origin=cloud, or left out.')
      const cursor = query.get('cursor')
      const after = cursor === null ? undefined : Buffer.from(cursor, 'base64url').toString('utf8')
      if (cursor !== null && (after === '' || Buffer.from(after ?? '', 'utf8').toString('base64url') !== cursor)) {
        return problem(response, 400, 'invalid_request', 'cursor is the next value of the previous page.')
      }
      const page = await backend.documents(workspace, { origin, ...(originRef !== null ? { originRef } : {}), raw: include === 'raw', ...(after !== undefined ? { after } : {}), limit: 500 })
      await done('ok')
      return json(response, 200, { documents: page.documents, ...(page.next ? { next: Buffer.from(page.next, 'utf8').toString('base64url') } : {}) })
    }

    if (route === 'documents/push') {
      if (!only('POST') || !needs('docket:write')) return
      const raw = await bodyOf(request)
      let body: Record<string, unknown>
      try {
        const parsed: unknown = raw === null ? null : JSON.parse(raw.toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
        body = parsed as Record<string, unknown>
      } catch {
        return problem(response, raw === null ? 413 : 400, 'invalid_request', raw === null ? 'The push is too large: send it in smaller batches.' : 'Send a JSON object.')
      }
      const { checkout, dryRun, upsert = [], remove = [] } = body
      if (typeof checkout !== 'string' || checkout.length === 0 || checkout.length > 200 || /[\s\u0000-\u001f\u007f]/.test(checkout)) {
        return problem(response, 400, 'invalid_request', 'checkout is a string of 1-200 characters, with no whitespace.')
      }
      if (dryRun !== undefined && typeof dryRun !== 'boolean') return problem(response, 400, 'invalid_request', 'dryRun is true or false.')
      const isFile = (value: unknown): value is { path: string; raw: string } =>
        typeof value === 'object' && value !== null && typeof (value as { path?: unknown }).path === 'string' && typeof (value as { raw?: unknown }).raw === 'string'
      if (!Array.isArray(upsert) || !upsert.every(isFile)) return problem(response, 400, 'invalid_request', 'upsert is a list of { path, raw } strings.')
      if (!Array.isArray(remove) || !remove.every((path) => typeof path === 'string')) return problem(response, 400, 'invalid_request', 'remove is a list of paths.')
      const result = await backend.push(
        workspace,
        { actor: principal.actor, label: `${principal.token} via docket serve`, requestId },
        { checkout, upsert: upsert.map(({ path, raw: text }) => ({ path, raw: text })), remove: remove as string[] },
        dryRun === true
      )
      await done(result.ok ? 'ok' : 'invalid', [checkout])
      return json(response, 200, result)
    }

    if (route === 'rebuild') {
      if (!only('POST') || !needs('docket:write')) return
      if (role !== 'owner' && role !== 'admin') {
        await done('denied')
        return problem(response, 403, 'insufficient_role', 'Only an owner or admin token rebuilds the projections.')
      }
      await backend.rebuild(workspace)
      await done('ok')
      return json(response, 200, { rebuilt: workspace.slug })
    }

    return problem(response, 404, 'not_found', `No API at ${url.pathname}.`)
  }

  /** The signed-in browser's session, checked against its token now: a revoked token ends it. */
  async function sessionOf(request: IncomingMessage): Promise<Session | null> {
    const id = cookieOf(request, SESSION_COOKIE)
    const session = id ? sessions.get(id) : undefined
    if (!id || !session) return null
    const workspace = workspaceOf(session.slug)
    const role = workspace ? await auth.authorizer.role({ subject: '', workspaceId: workspace.id, scopes: [], actor: '', token: session.token, slug: session.slug }) : null
    if (session.expires < Date.now() || role === null) {
      sessions.delete(id)
      return null
    }
    return session
  }

  const secure = (request: IncomingMessage) => baseUrl.startsWith('https:') || request.headers['x-forwarded-proto'] === 'https'

  async function login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(loginPage(backend.workspaces))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
      return
    }
    const fail = (status: number, message: string) => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(loginPage(backend.workspaces, message))
    }
    if (refused(addressOf(request))) return fail(429, 'Too many refused tokens from this address; try again in a minute.')
    const raw = await bodyOf(request)
    const form = new URLSearchParams(raw?.toString('utf8') ?? '')
    const token = form.get('token')?.trim() ?? ''
    const workspace = workspaceOf(form.get('workspace') ?? backend.workspaces[0]?.slug)
    const principal = workspace && token ? await auth.authenticator.resolve(token, resourceOf(workspace, `${baseUrl}/mcp/${workspace.slug}`)) : null
    if (!workspace || !principal || !(await effectiveScopes(principal, auth.authorizer)).includes('docket:read')) {
      await refuse(request, 'ui.login', 'denied')
      return fail(401, 'That token does not open this workspace.')
    }
    const id = randomBytes(24).toString('base64url')
    sessions.set(id, { token: principal.token, slug: workspace.slug, expires: Date.now() + SESSION_MS })
    await audit.record(null, { workspaceId: workspace.id, actor: principal.actor, action: 'ui.login', outcome: 'ok', target: [], latencyMs: 0, requestId: randomUUID(), ip: addressOf(request), userAgent: request.headers['user-agent'] ?? null })
    response.writeHead(303, {
      location: '/',
      'set-cookie': `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure(request) ? '; Secure' : ''}`
    })
    response.end()
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', baseUrl)
    const path = url.pathname

    if (path === '/healthz') return json(response, 200, { status: 'ok', service: SERVICE, version: VERSION, store: backend.kind })
    if (path === '/readyz') {
      const ready = await backend.ready()
      return json(response, ready.ok ? 200 : 503, { status: ready.ok ? 'ready' : 'unavailable', detail: ready.detail })
    }

    const metadata = /^\/\.well-known\/oauth-protected-resource(\/mcp(?:\/.*)?)$/.exec(path)
    if (metadata) {
      return json(response, 200, {
        resource: `${baseUrl}${metadata[1]}`,
        bearer_methods_supported: ['header'],
        scopes_supported: SCOPES,
        resource_name: 'Docket (docket serve)',
        resource_documentation: 'https://github.com/chrisjowen/docket/blob/main/docs/self-hosting.md'
      })
    }

    const mcpPath = /^\/mcp(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(path)
    if (mcpPath) {
      const [, first, second] = mcpPath
      const slug = second ?? first
      const single = backend.workspaces.length === 1 ? backend.workspaces[0] : undefined
      const workspace = slug === undefined ? (single ?? null) : workspaceOf(slug)
      if (slug === undefined && !single && request.method === 'POST') {
        return problem(response, 404, 'not_found', `This server serves several workspaces: connect to /mcp/<workspace>, one of ${backend.workspaces.map((each) => each.slug).join(', ')}.`)
      }
      return mcp(request, response, workspace, workspace ? `${baseUrl}${slug === undefined ? '/mcp' : `/mcp/${workspace.slug}`}` : `${baseUrl}${path}`)
    }

    const api = /^\/api\/(?:o\/[^/]+\/)?w\/([^/]+)\/(me|documents|documents\/push|rebuild)\/?$/.exec(path)
    if (api) return cli(request, response, url, workspaceOf(api[1]), api[2] as string)

    if (!config.ui) return problem(response, 404, 'not_found', `No route at ${path}.`)
    if (path === '/login') return login(request, response)
    if (path === '/logout') {
      const id = cookieOf(request, SESSION_COOKIE)
      if (id) sessions.delete(id)
      response.writeHead(303, { location: '/login', 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` })
      response.end()
      return
    }
    // A token in the page's URL is refused like anywhere else.
    if (credentialInUrl(url, [TOKEN_PREFIX])) return problem(response, 400, 'invalid_request', 'Never put a token in a URL.')
    const session = await sessionOf(request)
    if (!session) {
      if (path === '/api' || path.startsWith('/api/')) return problem(response, 401, 'invalid_token', 'Sign in at /login first.')
      // The page's own assets load before sign-in only through the sign-in page, which has none.
      response.writeHead(303, { location: '/login' })
      response.end()
      return
    }
    const page = views.get(session.slug)
    if (!page) return problem(response, 404, 'not_found', 'That workspace is no longer served here.')
    await page(request, response)
  }

  return {
    async handle(request, response) {
      try {
        await handle(request, response)
      } catch (cause) {
        console.error(`docket serve: ${request.method} ${request.url} failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
        if (!response.headersSent) problem(response, 500, 'server_error', 'The server failed to answer.')
        else response.destroy()
      }
    }
  }
}

