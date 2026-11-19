import { createMcpServer, type CanonicalSource } from '@chrisjowen/docket'

import { checkScope, effectiveScopes, type Refusal } from '../auth/effective.js'
import type { AuditEventInput, AuditOutcome, AuditSink, Authenticator, Authorizer, Limiter, McpMessage, McpResource, ModelGate, Principal, StoreContext, StoreRunner } from '../ports.js'
import { readDocuments } from '../postgres/documents.js'
import { publishedOntology, workspaceResolvedConfig } from '../postgres/source.js'
import type { Writer } from '../write/inputs.js'
import { isObject } from './args.js'
import type { ToolContext } from './context.js'
import type { ServerTool } from './context.js'
import type { QueryClient } from './query.js'
import { SERVER_INSTRUCTIONS, registryFor, scopeOf, serverTools } from './tools/index.js'

/**
 * A workspace's MCP endpoint as one function, `Request` in and `Response`
 * out, with no web framework: Streamable HTTP as `docket open` speaks it -
 * one JSON-RPC message per POST, JSON answers, no sessions - behind the
 * request pipeline: a bearer credential only, never in the URL; the
 * workspace from the host's routing; the credential's scopes cut to its
 * owner's role on every call; a deployment's rate limits; and one audit event
 * per request, which a write records in its own transaction, so the change
 * and its event commit together. A deployment supplies the ports.
 */

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
export const MAX_BODY_BYTES = 1024 * 1024

/**
 * CORS for the MCP endpoint, so a browser-based client (the MCP Inspector)
 * can connect. It authenticates by bearer only, never by cookie, so any
 * origin may call it; the response says which headers it may read.
 */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version, retry-after',
  'access-control-max-age': '600'
}

/** The token of `Authorization: Bearer <token>`, or null. */
export function bearerOf(request: Request): string | null {
  return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
}

/** Query parameter names a credential goes by: `access_token`, `token`, `api_key`, `client_secret`, `password`. */
const CREDENTIAL_PARAM = /token|secret|api[-_]?key|password/i

/**
 * Whether a URL carries a credential: a parameter named like one, or a value
 * with a token prefix the deployment issues. Such a request is refused, since
 * the URL ends up in proxy and browser logs.
 */
export function credentialInUrl(url: URL, tokenPrefixes: readonly string[] = ['dkt_live_', 'dmk_']): boolean {
  for (const [name, value] of url.searchParams) {
    if (CREDENTIAL_PARAM.test(name) || tokenPrefixes.some((prefix) => value.includes(prefix))) return true
  }
  return false
}

/** The protected resource metadata document's URL for an MCP URL: the well-known prefix inserted before its path (RFC 9728 §3.1). */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl)
  return new URL(`/.well-known/oauth-protected-resource${url.pathname}`, url.origin).toString()
}

/** The `WWW-Authenticate` challenge for a refused request (RFC 6750 §3), pointing at the resource's metadata. */
export function bearerChallenge(resourceUrl: string, refusal?: { error: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description?: string; scope?: string }): string {
  const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`
  const parts = [`resource_metadata=${quote(protectedResourceMetadataUrl(resourceUrl))}`]
  if (refusal) {
    parts.push(`error=${quote(refusal.error)}`)
    if (refusal.description) parts.push(`error_description=${quote(refusal.description)}`)
  }
  parts.push(`scope=${quote(refusal?.scope ?? 'docket:read')}`)
  return `Bearer ${parts.join(', ')}`
}

/** What the handler is given for one request: where it is for, and the deployment's ports. */
export interface McpHandlerOptions<P extends Principal = Principal, R extends McpResource = McpResource> {
  /** The MCP resource's canonical URL, which challenges point at. */
  resourceUrl: string
  /** The workspace the request's path names; null when there is none, which refuses the credential. */
  resource: R | null
  authenticator: Authenticator<P, R>
  authorizer: Authorizer<P>
  /** Where the principal's audit events go. */
  audit(principal: P): AuditSink
  /** The principal's workspace store. */
  store(principal: P): StoreRunner
  /**
   * The tools the request may call, made for its context: the eleven over
   * the store (`serverTools`) by default. A deployment that keeps its
   * documents elsewhere - a self-hosted server over a project's files -
   * offers its own, with the same names, schemas and scopes.
   */
  tools?(context: ToolContext, principal: P): ServerTool[]
  /** The principal's workspace documents, as the MCP server reads them: the store's by default. */
  source?(principal: P): CanonicalSource
  /** Where the principal's searches and questions are answered. */
  query(principal: P): QueryClient
  /** The principal's workspace pages, linked from results. */
  links(principal: P): { viewer: string; ontologyHistory: string }
  /** How evidence names the principal's writes; the principal's actor when absent. */
  writerLabel?(principal: P): Promise<string>
  /** The deployment's rate limits: a response to send instead, which it has audited itself. */
  limiter?: Limiter<P>
  /** Runs before every model call a tool makes. */
  modelGate?: ModelGate<P>
  /**
   * Refused credentials, before any lookup: `blocked` answers instead when
   * the client has been refused too often, and `record` counts and logs each
   * refusal.
   */
  refusedCredentials?: {
    blocked(): Promise<Response | null> | Response | null
    record(action: string, outcome: AuditOutcome): Promise<void>
  }
  /** Token prefixes refused in the URL, besides credential-named parameters. */
  tokenPrefixes?: readonly string[]
  requestId: string
  ip?: string | null
  userAgent?: string | null
  /** When the request started (`performance.now()`), for the audit event's latency. */
  startedAt?: number
  instructions?: string
  serverInfo?: { name: string; title?: string; version: string }
  /** The MCP app's built page, as docket's `createMcpServer` takes it. */
  appFile?: string
  /** Headers added to every response; CORS by default. */
  headers?: Record<string, string>
  /** Told about a failure the client is answered a generic error for. */
  onError?(cause: unknown): void
}

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
type JsonRpcResponse = { jsonrpc: '2.0'; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } }

/** A request's JSON-RPC id, as a refusal echoes it: a string or a number, else null. */
const jsonRpcId = (id: unknown): McpMessage['id'] => (typeof id === 'string' || typeof id === 'number' ? id : null)

/** How a JSON-RPC answer reads in the audit log. */
function outcomeOf(response: JsonRpcResponse | null): AuditOutcome {
  if (!response) return 'ok'
  if (response.error) return response.error.code === -32602 || response.error.code === -32600 ? 'invalid' : 'error'
  return response.result?.isError === true ? 'error' : 'ok'
}

/** The workspace's canonical documents, each read in a store transaction of its own. */
function storeSource(store: StoreRunner, workspaceId: string): CanonicalSource {
  return {
    resolved: workspaceResolvedConfig(workspaceId),
    async ontology() {
      const head = await store.run((ctx) => publishedOntology(ctx, workspaceId))
      if (!head) throw new Error('This workspace has no published ontology yet.')
      return { text: head.text, revision: head.revision }
    },
    async people() {
      return store.run(async (ctx) => ctx.people ?? null)
    },
    async *documents() {
      for (const document of await store.run((ctx) => readDocuments(ctx, workspaceId))) {
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    }
  }
}

/** Answers one MCP request: a POST of one JSON-RPC message, as the pipeline above. */
export async function handleMcp<P extends Principal, R extends McpResource>(request: Request, options: McpHandlerOptions<P, R>): Promise<Response> {
  const headers = options.headers ?? CORS_HEADERS
  const startedAt = options.startedAt ?? performance.now()
  const latency = () => Math.round(performance.now() - startedAt)
  const respond = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { ...headers, ...(body === null ? {} : { 'content-type': 'application/json' }), ...extra }
    })
  const refusal = (refused: Refusal | { status: 400 | 401; error: 'invalid_request' | 'invalid_token'; description?: string } | null) => {
    if (!refused) {
      return respond(401, { error: 'invalid_token', error_description: 'Send Authorization: Bearer <token>.' }, { 'www-authenticate': bearerChallenge(options.resourceUrl) })
    }
    const scope = 'scope' in refused ? refused.scope : undefined
    return respond(
      refused.status,
      { error: refused.error, ...(refused.description ? { error_description: refused.description } : {}) },
      {
        'www-authenticate': bearerChallenge(options.resourceUrl, {
          error: refused.error,
          ...(refused.description ? { description: refused.description } : {}),
          ...(scope ? { scope } : {})
        })
      }
    )
  }

  const blocked = await options.refusedCredentials?.blocked()
  if (blocked) {
    for (const [name, value] of Object.entries(headers)) blocked.headers.set(name, value)
    return blocked
  }
  // Tokens in query strings are refused: they end up in logs.
  if (credentialInUrl(new URL(request.url), options.tokenPrefixes)) {
    await options.refusedCredentials?.record('mcp.auth', 'invalid')
    return refusal({ status: 400, error: 'invalid_request', description: 'Send the token in the Authorization header, never in the URL.' })
  }
  const bearer = bearerOf(request)
  if (!bearer) return refusal(null)

  const principal = options.resource ? await options.authenticator.resolve(bearer, options.resource) : null
  if (!principal) {
    await options.refusedCredentials?.record('mcp.auth', 'denied')
    return refusal({ status: 401, error: 'invalid_token', description: 'This token is not valid for this workspace.' })
  }

  const sink = options.audit(principal)
  const store = options.store(principal)
  const auditEvent = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>): AuditEventInput => ({
    workspaceId: principal.workspaceId,
    actor: principal.actor,
    ip: options.ip ?? null,
    userAgent: options.userAgent ?? null,
    requestId: options.requestId,
    latencyMs: latency(),
    ...fields
  })
  const record = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>) => sink.record(null, auditEvent(fields))

  // The body is read before the rate limit, which needs the method and tool, and the id its tool error answers.
  const text = await request.text()
  let body: { message: Message } | { invalid: 'too-large' | 'not-json' | 'batch' }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) body = { invalid: 'too-large' }
  else {
    try {
      const parsed = JSON.parse(text) as unknown
      body = Array.isArray(parsed) ? { invalid: 'batch' } : { message: parsed as Message }
    } catch {
      body = { invalid: 'not-json' }
    }
  }
  const message = 'message' in body && isObject(body.message) ? body.message : null
  const method = message && typeof message.method === 'string' ? message.method : 'invalid'
  const params = message && isObject(message.params) ? message.params : {}
  const toolName = method === 'tools/call' && typeof params.name === 'string' ? params.name : null
  const action = `mcp.${method}${toolName ? ` ${toolName}` : ''}`.slice(0, 200)
  const args = method === 'tools/call' ? (params.arguments ?? {}) : params
  // The resource a call names (docket_get and the write tools take an id), for the audit log.
  const target = toolName && isObject(params.arguments) && typeof params.arguments.id === 'string' ? [params.arguments.id.slice(0, 200)] : []

  // A write tool records this request's audit event in its own transaction; otherwise the request is audited at the end.
  let audited = false
  let writer: Promise<Writer> | null = null
  const links = options.links(principal)
  const context: ToolContext = {
    workspaceId: principal.workspaceId,
    viewer: links.viewer,
    ontologyHistory: links.ontologyHistory,
    store,
    query: options.query(principal),
    beforeModelCall: async () => options.modelGate?.beforeModelCall(principal),
    actor: principal.actor,
    userId: principal.subject,
    ...(principal.actsFor !== undefined ? { actsFor: principal.actsFor } : {}),
    writer: () =>
      (writer ??= (options.writerLabel ? options.writerLabel(principal) : Promise.resolve(principal.actor)).then((label) => ({
        workspaceId: principal.workspaceId,
        actor: principal.actor,
        label,
        channel: 'mcp' as const,
        requestId: options.requestId,
        ...(principal.actsFor !== undefined ? { principal: principal.actsFor } : {})
      }))),
    role: () => options.authorizer.role(principal),
    audited: async <T>(fn: (ctx: StoreContext) => Promise<{ value: T; outcome: AuditOutcome; target: string[] }>) => {
      const value = await store.run(async (ctx) => {
        const done = await fn(ctx)
        await sink.record(ctx, auditEvent({ action, outcome: done.outcome, args, target: done.target }))
        return done.value
      })
      audited = true
      return value
    }
  }
  const tools = options.tools ? options.tools(context, principal) : serverTools(context)

  const limited = await options.limiter?.check(principal, { jsonrpc: '2.0', id: jsonRpcId(message?.id), method, params })
  if (limited) {
    for (const [name, value] of Object.entries(headers)) limited.headers.set(name, value)
    return limited
  }

  // ontology:write is effective only while the workspace's setting names the owner's role: read on every call.
  const effective = await effectiveScopes(principal, options.authorizer)
  if (effective.length === 0) {
    await record({ action: 'mcp.auth', outcome: 'denied' })
    return refusal(checkScope(effective, 'docket:read'))
  }

  const version = request.headers.get('mcp-protocol-version')
  if (version && !PROTOCOL_VERSIONS.includes(version)) {
    await record({ action: 'mcp.protocol', outcome: 'invalid' })
    return respond(400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${version}; this server speaks ${PROTOCOL_VERSIONS.join(', ')}.` }
    })
  }

  if ('invalid' in body) {
    await record({ action: 'mcp.request', outcome: 'invalid' })
    if (body.invalid === 'too-large') return respond(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'The request is too large.' } })
    if (body.invalid === 'not-json') return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'The body is not JSON.' } })
    return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one JSON-RPC message per POST.' } })
  }

  // A tool the credential's effective scopes do not reach is refused as the MCP authorization spec says: 403 insufficient_scope.
  const needed = toolName ? scopeOf(tools, toolName) : null
  const refused = needed ? checkScope(effective, needed) : null
  if (refused) {
    await record({ action, outcome: 'denied', args, target })
    return refusal(refused)
  }

  const source = options.source ? options.source(principal) : storeSource(store, principal.workspaceId)
  // A deployment's own tools link their results to its viewer through the MCP server's context.
  const server = createMcpServer({ source, tools: registryFor(tools, effective), appFile: options.appFile, ...(options.tools ? { viewer: links.viewer } : {}) })
  let response: JsonRpcResponse | null
  try {
    response = (await server.handle(body.message)) as JsonRpcResponse | null
  } catch (cause) {
    options.onError?.(cause)
    response = { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'The server failed to answer.' } }
  }
  if (method === 'initialize' && response?.result) {
    response = {
      ...response,
      result: {
        ...response.result,
        instructions: options.instructions ?? SERVER_INSTRUCTIONS,
        ...(options.serverInfo ? { serverInfo: options.serverInfo } : {})
      }
    }
  }
  if (!audited) await record({ action, outcome: outcomeOf(response), args, target })
  // A notification or a response sent to the server: accepted, nothing to say (Streamable HTTP).
  if (!response) return respond(202, null)
  return respond(200, response)
}
