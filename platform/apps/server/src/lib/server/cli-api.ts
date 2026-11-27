// SPDX-License-Identifier: AGPL-3.0-only
import { audit, type AuditEventInput, type Outcome } from '@docket/platform-audit'
import { bearerChallenge, checkScope, effectiveScopes, mcpResourceUrl, type McpResource, type Principal, type Scope } from '@docket/platform-auth'
import { ontologyMcpRoles, type StoreContext } from '@docket/platform-canonical-store'
import { mcpLimits, rateLimitMessage, writeLimits, type Limit } from '@docket/platform-limits'
import { namespaceAccess, type NamespacePermission, type Role, type Tx } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { bearerOf, credentialInUrl, locateWorkspace, refusedCredentials } from './bearer'
import { clientAddress } from './request'
import { getRuntime, type Runtime } from './runtime'

/**
 * The CLI's API (`docket cloud`): `/api/o/{org}/w/{ws}/...`, JSON, behind the
 * same pipeline as the workspace's MCP endpoint (§3) - a bearer token only
 * (an API token for the workspace, or an OAuth access token whose resource
 * is its MCP URL), the same lookup and revocation cache, the effective
 * permission (scopes ∩ the caller's permission on the workspace now), the MCP
 * rate limits, and one audit event per call, its action `cli.<route>`. Every
 * refusal carries an OAuth-style `error`, which is how the CLI tells it from a
 * route this server does not have (SvelteKit's own 404 has none).
 */

export interface CliRoute {
  /** The audit action, after `cli.`: `me`, `tokens.create`, `documents.push`. */
  action: string
  /** The scope the call needs; any effective scope will do when absent. */
  scope?: Scope
  /** OAuth access tokens only: a token never mints or manages tokens. */
  oauthOnly?: boolean
  /** Counts against the per-token write limit, as an MCP write tool does. */
  write?: boolean
  /** Limits of the route's own, on top of the MCP ones: creating a token counts against its person's. */
  limits?: (principal: Principal) => Limit[]
}

export interface CliCall {
  runtime: Runtime
  principal: Principal
  resource: McpResource
  orgSlug: string
  workspaceSlug: string
  effective: Scope[]
  /** The caller's org role now. */
  role: Role
  /** The caller's permission on this workspace now: what the namespace matrix (`canInNamespace`) decides on. */
  permission: NamespacePermission
  /** Runs `fn` in one transaction as the org, with its data keys. */
  inTenant<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T>
  /** The call's audit event, written in `tx`: the transaction that made its change. */
  audit(tx: Tx, fields: { outcome: Outcome; target?: string[]; args?: unknown }): Promise<void>
  /** The request's JSON object body. */
  json(): Promise<Record<string, unknown>>
}

/** A refusal a route answers with: an HTTP status and an OAuth-style error code. */
export class CliError extends Error {
  override name = 'CliError'
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function cliJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
}

const problem = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  cliJson(status, { error, error_description: description }, headers)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function outcomeOf(status: number): Outcome {
  if (status < 400) return 'ok'
  if (status === 401 || status === 403 || status === 404) return 'denied'
  if (status < 500) return 'invalid'
  return 'error'
}

export async function handleCli(event: RequestEvent, route: CliRoute, run: (call: CliCall) => Promise<Response>): Promise<Response> {
  const runtime = getRuntime()
  const orgSlug = event.params.org ?? ''
  const workspaceSlug = event.params.ws ?? ''
  const resourceUrl = mcpResourceUrl(runtime.origin, orgSlug, workspaceSlug)
  const action = `cli.${route.action}`
  const ip = clientAddress(event)
  const challenge = (refusal?: Parameters<typeof bearerChallenge>[1]) => ({ 'www-authenticate': bearerChallenge(resourceUrl, refusal) })
  const invalidToken = (description: string) => problem(401, 'invalid_token', description, challenge({ error: 'invalid_token', description }))
  const recordRefused = refusedCredentials(event, runtime, resourceUrl)

  const blocked = runtime.refusedAuth.check(ip ?? 'unknown')
  if (!blocked.ok) {
    return problem(429, 'rate_limited', 'Too many refused credentials from this address; try again later.', { 'retry-after': String(blocked.retryAfterSeconds) })
  }
  // Tokens in query strings are refused (§3 step 2): they end up in logs.
  if (credentialInUrl(event.url)) {
    await recordRefused('cli.auth', 'invalid')
    return problem(400, 'invalid_request', 'Send the token in the Authorization header, never in the URL.')
  }
  const bearer = bearerOf(event.request)
  if (!bearer) return problem(401, 'invalid_token', 'Send Authorization: Bearer <token>.', challenge())

  const resource = await locateWorkspace(runtime, orgSlug, workspaceSlug)
  const principal = resource ? await runtime.tokens.resolveBearer(bearer, resource) : null
  if (!resource || !principal) {
    await recordRefused('cli.auth', 'denied')
    // A live credential for another workspace, in this org or another: that workspace is none of its business.
    if (await runtime.tokens.isLive(bearer)) return problem(404, 'not_found', 'This token is not for that workspace, or there is no such workspace.')
    return invalidToken('This token is not valid for this workspace.')
  }

  const auditFields = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>): AuditEventInput => ({
    ip,
    userAgent: event.request.headers.get('user-agent'),
    requestId: event.locals.requestId,
    orgId: principal.orgId,
    workspaceId: principal.workspaceId,
    actor: principal.actor,
    latencyMs: performance.now() - event.locals.startedAt,
    ...fields,
  })
  const record = (fields: { outcome: Outcome; target?: string[] }) =>
    runtime.router.withTenant(principal.orgId, (tx: Tx) => audit(tx, auditFields({ action, ...fields })))

  // The MCP rate limits (§12): 120 calls a minute per token and 600 per org, and 30 writes a minute per token.
  const decision = await runtime.limiter.check([...mcpLimits(principal), ...(route.write ? writeLimits(principal) : []), ...(route.limits?.(principal) ?? [])])
  if (!decision.allowed) {
    await record({ outcome: 'denied', target: [`rate-limit:${decision.limit.what ?? 'calls'}-per-${decision.limit.scope}`] })
    return problem(429, 'rate_limited', rateLimitMessage(decision), { 'retry-after': String(decision.retryAfterSeconds) })
  }

  const effective = await effectiveScopes(principal, {
    platform: (fn) => runtime.router.withPlatform(fn),
    ontologyWriters: () => runtime.router.withTenant(principal.orgId, (tx) => ontologyMcpRoles(tx, principal.workspaceId)),
  })
  const access = await runtime.router.withPlatform((tx) => namespaceAccess(tx, principal.orgId, principal.workspaceId, principal.userId))
  if (effective.length === 0 || !access?.permission) {
    await record({ outcome: 'denied' })
    return invalidToken('This credential no longer grants anything in this workspace.')
  }
  const { role, permission } = access
  if (route.oauthOnly && principal.via !== 'oauth') {
    await record({ outcome: 'denied' })
    const description = 'An API token cannot manage tokens: sign in with docket cloud login.'
    return problem(403, 'insufficient_scope', description, challenge({ error: 'insufficient_scope', description }))
  }
  const refused = route.scope ? checkScope(effective, route.scope) : null
  if (refused) {
    await record({ outcome: 'denied' })
    const scope = 'scope' in refused ? refused.scope : undefined
    return problem(refused.status, refused.error, refused.description, challenge({ error: refused.error, description: refused.description, ...(scope ? { scope } : {}) }))
  }

  let audited = false
  const call: CliCall = {
    runtime,
    principal,
    resource,
    orgSlug,
    workspaceSlug,
    effective,
    role,
    permission,
    async inTenant(fn) {
      const keys = await runtime.keyring.forOrg(principal.orgId)
      return runtime.router.withTenant(principal.orgId, (tx) => fn({ tx, keys }))
    },
    async audit(tx, fields) {
      await audit(tx, auditFields({ action, ...fields }))
      audited = true
    },
    async json() {
      if (!/^application\/json(\s*;|$)/i.test(event.request.headers.get('content-type') ?? '')) {
        throw new CliError(400, 'invalid_request', 'Send a JSON body, with content-type: application/json.')
      }
      let body: unknown
      try {
        body = JSON.parse(await event.request.text())
      } catch {
        throw new CliError(400, 'invalid_request', 'The body is not JSON.')
      }
      if (!isObject(body)) throw new CliError(400, 'invalid_request', 'The body is a JSON object.')
      return body
    },
  }

  let response: Response
  try {
    response = await run(call)
  } catch (cause) {
    // Whatever the route audited went with its transaction.
    audited = false
    if (cause instanceof CliError) response = problem(cause.status, cause.code, cause.message)
    else {
      console.error(`[${event.locals.requestId}] ${action}: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
      response = problem(500, 'server_error', 'The server failed to answer.')
    }
  }
  if (!audited) await record({ outcome: outcomeOf(response.status) })
  return response
}
