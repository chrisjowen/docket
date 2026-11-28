// SPDX-License-Identifier: AGPL-3.0-only
import { API_VERSION, ERROR_STATUS, matchOperation, type ApiErrorCode, type Operation } from '@docket/api'
import { CapError, ProviderKeyError, SettingsError } from '@docket/platform-ai'
import { ApiTokenError, ConnectionError, TokenRevocationError } from '@docket/platform-auth'
import { CogneeSettingsError, WorkspaceError } from '@docket/platform-canonical-store'
import { EnrichmentSettingsError, NoOntology } from '@docket/platform-enrichment'
import { perMinute, rateLimitMessage } from '@docket/platform-limits'
import { OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange, StaleDraft, VersionNotFound } from '@docket/platform-ontology-service'
import { TenancyError } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'
import type { z } from 'zod'

import { credentialInUrl, refusedCredentials } from '../bearer'
import { clientAddress } from '../request'
import { getRuntime } from '../runtime'
import { ApiFailure, authenticate, readsOnly } from './caller'
import { HANDLERS, recordCall, type ApiCall } from './handlers'

/**
 * `/api/v1` (tenancy v2 §3.5; open-source plan §1): every operation in
 * `@docket/api`'s `OPERATIONS`, routed, authenticated, checked and validated
 * by that one definition. A browser session (with its CSRF token on every
 * call that is not a GET, which the hooks check) and a bearer token or OAuth
 * connection resolve to the same principal, and every call needs the
 * capability the app's button needs, on the place it names. Each call is
 * rate limited per caller and recorded once in the account's audit log;
 * refused credentials are limited per address like MCP's.
 */

/** Calls a minute per caller: a person's session, or one token or connection. */
export const CALLS_PER_MINUTE = 240

/** What a refusal from the stores reads as on the API. */
export function errorOf(cause: unknown): ApiFailure {
  if (cause instanceof ApiFailure) return cause
  if (cause instanceof TenancyError) {
    const code: ApiErrorCode = { forbidden: 'forbidden', 'not-found': 'not_found', conflict: 'conflict', 'last-owner': 'conflict', limit: 'forbidden', invalid: 'invalid_request' }[
      cause.code
    ] as ApiErrorCode
    return new ApiFailure(code, cause.message)
  }
  if (cause instanceof WorkspaceError) {
    const code: ApiErrorCode = { invalid: 'invalid_request', conflict: 'conflict', limit: 'forbidden', 'not-found': 'not_found' }[cause.code] as ApiErrorCode
    return new ApiFailure(code, cause.message)
  }
  if (cause instanceof ApiTokenError) {
    return new ApiFailure(cause.code === 'forbidden' ? 'forbidden' : cause.code === 'not-found' ? 'not_found' : 'invalid_request', cause.message)
  }
  if (cause instanceof TokenRevocationError) return new ApiFailure('not_found', cause.message)
  if (cause instanceof ConnectionError) return new ApiFailure(/choose/i.test(cause.message) ? 'invalid_request' : 'not_found', cause.message)
  if (cause instanceof OntologyInvalid) return new ApiFailure('invalid_request', 'That is not a docket ontology.')
  if (cause instanceof VersionNotFound) return new ApiFailure('invalid_request', cause.message)
  // Settings outside what the places above allow, or out of range: the resolver's own words, never a key.
  if (
    cause instanceof SettingsError ||
    cause instanceof CapError ||
    cause instanceof ProviderKeyError ||
    cause instanceof EnrichmentSettingsError ||
    cause instanceof CogneeSettingsError ||
    cause instanceof NoOntology
  ) {
    return new ApiFailure('invalid_request', cause.message)
  }
  if (cause instanceof StaleDraft) return new ApiFailure('conflict', 'The ontology changed while this was saved: try again.')
  if (cause instanceof OntologyBreakingChange || cause instanceof OntologyNarrowingChange) {
    return new ApiFailure('conflict', 'Adding what enrichment needs to the ontology would change how existing documents validate: publish it from the Ontology tab instead.')
  }
  return new ApiFailure('server_error', 'The server failed to answer.')
}

export const outcomeOf = (status: number) =>
  status < 400 ? ('ok' as const) : [401, 403, 404, 405, 429].includes(status) ? ('denied' as const) : status < 500 ? ('invalid' as const) : ('error' as const)

function respond(status: number, body: unknown, requestId: string, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'content-type': 'application/json' }),
      'cache-control': 'no-store',
      'x-request-id': requestId,
      // What a client checks it fits (`compatible`): a web UI hosted apart from its server, a CLI.
      'x-docket-api-version': API_VERSION,
      ...headers,
    },
  })
}

export function failure(error: ApiFailure, requestId: string): Response {
  return respond(
    ERROR_STATUS[error.code],
    { error: error.code, error_description: error.message, request_id: requestId, ...(error.issues ? { issues: error.issues } : {}) },
    requestId,
    error.headers,
  )
}

function issuesOf(where: string, error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: [where, ...issue.path.map(String)].join('.'), message: issue.message }))
}

/** One of a request's parts, checked against its schema: an `invalid_request` naming what is wrong. */
function parsed(where: string, schema: z.ZodType | undefined, value: unknown): Record<string, unknown> {
  if (!schema) return {}
  const result = schema.safeParse(value)
  if (!result.success) throw new ApiFailure('invalid_request', `The request's ${where} is not valid.`, issuesOf(where, result.error))
  return result.data as Record<string, unknown>
}

async function bodyOf(event: RequestEvent, operation: Operation): Promise<unknown> {
  if (!operation.body) return undefined
  if (!/^application\/json(\s*;|$)/i.test(event.request.headers.get('content-type') ?? '')) {
    throw new ApiFailure('invalid_request', 'Send content-type: application/json.')
  }
  try {
    return await event.request.json()
  } catch {
    throw new ApiFailure('invalid_request', 'The body is not JSON.')
  }
}

export async function handleApiV1(event: RequestEvent): Promise<Response> {
  const runtime = getRuntime()
  const requestId = event.locals.requestId
  const address = clientAddress(event) ?? 'unknown'
  const blocked = runtime.refusedAuth.check(address)
  if (!blocked.ok) {
    return failure(new ApiFailure('rate_limited', 'Too many refused credentials from this address; try again later.', undefined, { 'retry-after': String(blocked.retryAfterSeconds) }), requestId)
  }
  const found = matchOperation(event.request.method, event.url.pathname)
  if (!found) return failure(new ApiFailure('not_found', 'No such operation. GET /api/v1/openapi.json lists them.'), requestId)
  if ('allowed' in found) return failure(new ApiFailure('method_not_allowed', `This takes ${found.allowed.join(', ')}.`, undefined, { allow: found.allowed.join(', ') }), requestId)
  const { operation } = found
  const handler = HANDLERS[operation.id]
  if (!handler) return failure(new ApiFailure('server_error', 'The server failed to answer.'), requestId)

  let call: ApiCall | null = null
  try {
    if (credentialInUrl(event.url)) throw new ApiFailure('invalid_request', 'Send credentials only in the Authorization header, never in the URL.')
    let caller
    try {
      caller = await authenticate(event)
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.code === 'invalid_token') await refusedCredentials(event, runtime, `${runtime.origin}/api/v1`)('api.auth', 'denied')
      throw cause
    }
    call = {
      caller,
      meta: {
        requestId,
        ip: clientAddress(event),
        userAgent: event.request.headers.get('user-agent'),
        startedAt: event.locals.startedAt,
        csrf: event.locals.csrf,
      },
      params: {},
      query: {},
      body: {},
      audit: { orgId: null, target: [], written: false },
      action: `api.${operation.id}`,
    }
    // Recorded here, once, in the account's log when the call names one: not again by the hooks.
    event.locals.audited = true
    if (!operation.auth.includes(caller.via)) {
      throw new ApiFailure('forbidden', operation.auth.length === 1 && operation.auth[0] === 'session' ? 'Only your own browser session can do this, never a token.' : 'This credential cannot make this call.')
    }
    // A read-only token or connection reads, and nothing else (tenancy v2 §3.4).
    if (caller.credential && readsOnly(caller.credential) && !operation.readOnly) throw new ApiFailure('read_only', 'This token or connection is read-only.')
    const decision = await runtime.limiter.check([{ scope: caller.credential ? 'token' : 'person', key: `api:${caller.credential?.tokenId ?? caller.user.id}`, rule: perMinute(CALLS_PER_MINUTE) }])
    if (!decision.allowed) throw new ApiFailure('rate_limited', rateLimitMessage(decision), undefined, { 'retry-after': String(decision.retryAfterSeconds) })

    call.params = parsed('path', operation.params, found.params) as Record<string, string>
    call.query = parsed('query', operation.query, Object.fromEntries(event.url.searchParams))
    call.body = parsed('body', operation.body, await bodyOf(event, operation))
    const answer = await handler(call)
    const status = answer.status ?? operation.status
    await recordCall(call, 'ok')
    return respond(status, status === 204 ? null : answer.body, requestId)
  } catch (cause) {
    const error = errorOf(cause)
    if (error.code === 'server_error') console.error(`[${requestId}] api ${operation.id}: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
    if (call) {
      try {
        await recordCall(call, outcomeOf(ERROR_STATUS[error.code]))
      } catch (auditError) {
        console.error(`[${requestId}] audit: ${auditError instanceof Error ? auditError.message : String(auditError)}`)
      }
    }
    return failure(error, requestId)
  }
}
