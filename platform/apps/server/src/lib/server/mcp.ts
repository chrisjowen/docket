// SPDX-License-Identifier: AGPL-3.0-only
import { createMcpServer, type CanonicalSource } from '@chrisjowen/docket'
import { docketCapScope } from '@docket/platform-ai'
import { audit, type AuditEventInput, type Outcome } from '@docket/platform-audit'
import {
  actsFor,
  bearerChallenge,
  checkScope,
  effectiveScopes,
  mcpResourceUrl,
  principalLabel,
  type Principal,
  type Refusal,
} from '@docket/platform-auth'
import { cloudResolvedConfig, publishedOntology, readDocuments, type StoreContext, type Writer } from '@docket/platform-canonical-store'
import { mcpRateLimit, type McpMessage } from '@docket/platform-limits'
import { SERVER_INSTRUCTIONS, cloudTools, isWriteTool, registryFor, scopeOf } from '@docket/platform-mcp-tools'
import type { Tx } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { bearerOf, credentialInUrl, locateWorkspace, refusedCredentials } from './bearer'
import { CORS_HEADERS } from './cors'
import { clientAddress } from './request'
import { getRuntime } from './runtime'

/**
 * The workspace MCP endpoint (§9): `POST /mcp/{org}/{workspace}`, Streamable
 * HTTP as `docket open` speaks it - one JSON-RPC message per POST, JSON
 * answers, no sessions - behind the request pipeline (§3): a bearer token
 * only, the tenant from the path, the credential's scopes cut to its owner's
 * capabilities on the docket on every call (§8.4; tenancy v2 §3.1: every
 * grant that covers it), the rate limits (§12: 120 calls a minute per
 * token, 600 per org, and 30 writes a minute per token, in token buckets every
 * replica shares), and one audit event per request with a digest of the
 * arguments, never the arguments (§10).
 * A write and its audit event commit in one transaction.
 * Refused credentials are limited per client address before any lookup, and
 * recorded in the platform log as the start of a burst, at most once a minute
 * per address, resource, action and outcome.
 */

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
export const MAX_BODY_BYTES = 1024 * 1024

export type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
export type JsonRpcResponse = { jsonrpc: '2.0'; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } }

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A request's JSON-RPC id, as a refusal echoes it: a string or a number, else null. */
export const jsonRpcId = (id: unknown): McpMessage['id'] => (typeof id === 'string' || typeof id === 'number' ? id : null)

export function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...(body === null ? {} : { 'content-type': 'application/json' }), ...headers },
  })
}

export function refusal(resourceUrl: string, refused: Refusal | { status: 400 | 401; error: 'invalid_request' | 'invalid_token'; description?: string } | null): Response {
  if (!refused) return respond(401, { error: 'invalid_token', error_description: 'Send Authorization: Bearer <token>.' }, { 'www-authenticate': bearerChallenge(resourceUrl) })
  const scope = 'scope' in refused ? refused.scope : undefined
  return respond(
    refused.status,
    { error: refused.error, ...(refused.description ? { error_description: refused.description } : {}) },
    { 'www-authenticate': bearerChallenge(resourceUrl, { error: refused.error, ...(refused.description ? { description: refused.description } : {}), ...(scope ? { scope } : {}) }) },
  )
}

/** The workspace's canonical documents, each read in a tenant transaction of its own. */
export function tenantSource(inTenant: <T>(fn: (ctx: StoreContext) => Promise<T>) => Promise<T>, workspaceId: string): CanonicalSource {
  return {
    resolved: cloudResolvedConfig(workspaceId),
    async ontology() {
      const head = await inTenant((ctx) => publishedOntology(ctx, workspaceId))
      if (!head) throw new Error('This workspace has no published ontology yet.')
      return { text: head.text, revision: head.revision }
    },
    async *documents() {
      for (const document of await inTenant((ctx) => readDocuments(ctx, workspaceId))) {
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    },
  }
}

/** How a JSON-RPC answer reads in the audit log. */
export function outcomeOf(response: JsonRpcResponse | null): Outcome {
  if (!response) return 'ok'
  if (response.error) return response.error.code === -32602 || response.error.code === -32600 ? 'invalid' : 'error'
  return response.result?.isError === true ? 'error' : 'ok'
}

export async function handleMcp(event: RequestEvent): Promise<Response> {
  const runtime = getRuntime()
  const orgSlug = event.params.acct ?? ''
  const workspaceSlug = event.params.docket ?? ''
  const resourceUrl = mcpResourceUrl(runtime.origin, orgSlug, workspaceSlug)
  const base = {
    ip: clientAddress(event),
    userAgent: event.request.headers.get('user-agent'),
    requestId: event.locals.requestId,
  }
  const latency = () => performance.now() - event.locals.startedAt
  const address = base.ip ?? 'unknown'
  const recordRefused = refusedCredentials(event, runtime, resourceUrl)

  const blocked = runtime.refusedAuth.check(address)
  if (!blocked.ok) {
    return respond(429, { error: 'rate_limited', error_description: 'Too many refused credentials from this address; try again later.' }, { 'retry-after': String(blocked.retryAfterSeconds) })
  }

  // Tokens in query strings are refused (§3 step 2): they end up in logs.
  if (credentialInUrl(event.url)) {
    await recordRefused('mcp.auth', 'invalid')
    return refusal(resourceUrl, { status: 400, error: 'invalid_request', description: 'Send the token in the Authorization header, never in the URL.' })
  }
  const bearer = bearerOf(event.request)
  if (!bearer) return refusal(resourceUrl, null)

  const resource = await locateWorkspace(runtime, orgSlug, workspaceSlug)
  const principal: Principal | null = resource ? await runtime.tokens.resolveBearer(bearer, resource) : null
  if (!resource || !principal) {
    await recordRefused('mcp.auth', 'denied')
    return refusal(resourceUrl, { status: 401, error: 'invalid_token', description: 'This token is not valid for this workspace.' })
  }

  const auditFields = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>): AuditEventInput => ({
    ...base,
    orgId: principal.orgId,
    workspaceId: principal.workspaceId,
    actor: principal.actor,
    latencyMs: latency(),
    ...fields,
  })
  const record = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>) =>
    runtime.router.withTenant(principal.orgId, (tx: Tx) => audit(tx, auditFields(fields)))

  // The body is read before the rate limit, which needs the method and tool (a write counts against the write limit
  // too) and the id its tool error answers; a body refused below still counts as a call.
  const text = await event.request.text()
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
  // The resource a call names (docket_get and the write tools take an id), for the org's log only.
  const target = toolName && isObject(params.arguments) && typeof params.arguments.id === 'string' ? [params.arguments.id.slice(0, 200)] : []

  const inTenant = async <T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> => {
    const keys = await runtime.keyring.forOrg(principal.orgId)
    return runtime.router.withTenant(principal.orgId, (tx) => fn({ tx, keys }))
  }
  // A write tool records this request's audit event in its own transaction; then the request is audited.
  let audited = false
  let writer: Promise<Writer> | null = null
  const tools = cloudTools({
    orgId: principal.orgId,
    workspaceId: principal.workspaceId,
    viewer: new URL(`/a/${orgSlug}/d/${workspaceSlug}/graph`, runtime.origin).toString(),
    ontologyHistory: new URL(`/a/${orgSlug}/d/${workspaceSlug}/ontology/history`, runtime.origin).toString(),
    inTenant,
    query: runtime.query,
    assertWithinCap: async () =>
      runtime.caps.assertWithinCap(principal.orgId, await runtime.router.withPlatform((tx) => docketCapScope(tx, principal.orgId, principal.workspaceId))),
    actor: principal.actor,
    userId: principal.userId,
    writer: () =>
      (writer ??= runtime.router
        .withPlatform(async (tx) => ({ label: await principalLabel(tx, principal), person: await actsFor(tx, principal.userId) }))
        .then(({ label, person }) => ({
          workspaceId: principal.workspaceId,
          actor: principal.actor,
          label,
          channel: 'mcp' as const,
          requestId: base.requestId,
          ...(person ? { principal: person } : {}),
        }))),
    // Asked again under the publish's locks: Publish ontology changes on this docket, cut by the credential.
    mayPublish: async () => (await effectiveScopes(principal, { platform: (fn) => runtime.router.withPlatform(fn) })).includes('ontology:write'),
    audited: async (fn) => {
      const value = await inTenant(async (ctx) => {
        const done = await fn(ctx)
        await audit(ctx.tx, auditFields({ action, outcome: done.outcome, args, target: done.target }))
        return done.value
      })
      audited = true
      return value
    },
  })

  // Pipeline step 5 (§12): refused with 429 and Retry-After, as a tool error the model reads, audited as denied.
  const limit = mcpRateLimit<Principal>({
    limiter: runtime.limiter,
    isWriteTool: (name) => isWriteTool(tools, name),
    audit: async ({ refusal: refused }) => {
      await record({ action, outcome: 'denied', args, target: [`rate-limit:${refused.limit.what ?? 'calls'}-per-${refused.limit.scope}`] })
    },
  })
  const limited = await limit(principal, { id: jsonRpcId(message?.id), method, params })
  if (limited) {
    for (const [name, value] of Object.entries(CORS_HEADERS)) limited.headers.set(name, value)
    return limited
  }

  // What the owner may do on the docket now, read on every call: ontology:write only while they hold Publish there.
  const effective = await effectiveScopes(principal, { platform: (fn) => runtime.router.withPlatform(fn) })
  if (effective.length === 0) {
    await record({ action: 'mcp.auth', outcome: 'denied' })
    return refusal(resourceUrl, checkScope(effective, 'docket:read'))
  }

  const version = event.request.headers.get('mcp-protocol-version')
  if (version && !PROTOCOL_VERSIONS.includes(version)) {
    await record({ action: 'mcp.protocol', outcome: 'invalid' })
    return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${version}; this server speaks ${PROTOCOL_VERSIONS.join(', ')}.` } })
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
    return refusal(resourceUrl, refused)
  }

  // The app wears the cloud's look (src/mcp-app); server.js names its page. Unset (vite dev): docket's own.
  const server = createMcpServer({ source: tenantSource(inTenant, principal.workspaceId), tools: registryFor(tools, effective), appFile: process.env.DOCKET_MCP_APP })
  let response: JsonRpcResponse | null
  try {
    response = (await server.handle(body.message)) as JsonRpcResponse | null
  } catch (cause) {
    console.error(`[${event.locals.requestId}] mcp: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
    response = { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'The server failed to answer.' } }
  }
  if (method === 'initialize' && response?.result) {
    response = { ...response, result: { ...response.result, instructions: SERVER_INSTRUCTIONS, serverInfo: { name: 'docket-cloud', title: 'Docket Cloud', version: '0.1.0' } } }
  }
  if (!audited) await record({ action, outcome: outcomeOf(response), args, target })
  // A notification or a response sent to the server: accepted, nothing to say (Streamable HTTP).
  if (!response) return respond(202, null)
  return respond(200, response)
}
