// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { redactConsole } from '@docket/platform-audit'
import { CSRF_FIELD, CSRF_HEADER, SESSION_COOKIE, csrfToken, readSession, verifyCsrf } from '@docket/platform-auth'
import { rateLimitMessage, signInLimits } from '@docket/platform-limits'
import { isUserAllowlisted, userById } from '@docket/platform-tenancy'
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit'

import { observeRequest } from '$lib/server/metrics'
import { withFrameAncestors } from '$lib/server/preview'
import { clientAddress, recordStandalone } from '$lib/server/request'
import { RuntimeUnavailable, getRuntime, initRuntime } from '$lib/server/runtime'
import { THEME_COOKIE, withTheme } from '$lib/theme'

// No credential reaches the logs, whichever line prints it (§19): the app's, the OAuth server's, a library's.
redactConsole()

export const init: ServerInit = initRuntime

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Routes that answer without the runtime: probes, and the sign-in page's static parts. */
const PROBES = new Set(['/healthz', '/readyz'])
/** The sign-in flow, rate limited per client address (§19). */
const SIGN_IN = /^\/(?:signin(?:\/|$)|auth\/github(?:\/|$))/
/**
 * The body a route takes. The server's BODY_SIZE_LIMIT is GitHub's 25 MB
 * payload cap, for its webhook alone: a push that deletes or renames many
 * files lists every path. Every other route keeps the §12 ceiling of 1 MB.
 */
const BODY_LIMIT = 1024 * 1024
const WEBHOOK = '/api/github/webhook'

function bodyTooLarge(request: Request, pathname: string): boolean {
  if (pathname === WEBHOOK || request.body === null) return false
  const length = request.headers.get('content-length')
  return length === null || !(Number(length) <= BODY_LIMIT)
}

function outcomeOf(status: number) {
  if (status < 400) return 'ok' as const
  if (status === 401 || status === 403 || status === 404) return 'denied' as const
  if (status < 500) return 'invalid' as const
  return 'error' as const
}

async function csrfTokenOf(request: Request): Promise<unknown> {
  const header = request.headers.get(CSRF_HEADER)
  if (header) return header
  const type = request.headers.get('content-type') ?? ''
  if (type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data')) {
    try {
      return (await request.clone().formData()).get(CSRF_FIELD)
    } catch {
      return undefined
    }
  }
  return undefined
}

export const handle: Handle = async (input) => {
  const started = performance.now()
  let status = 500
  try {
    const response = await route(input)
    status = response.status
    return response
  } finally {
    if (!PROBES.has(input.event.url.pathname)) {
      observeRequest(input.event.request.method, input.event.route.id, status, (performance.now() - started) / 1000)
    }
  }
}

const route: Handle = async ({ event, resolve }) => {
  event.locals.requestId = randomUUID()
  event.locals.startedAt = performance.now()
  event.locals.user = null
  event.locals.sessionSecret = null
  event.locals.csrf = null
  event.locals.audited = false
  event.locals.auditOrgId = null

  if (bodyTooLarge(event.request, event.url.pathname)) {
    return new Response('The request body is too large.', { status: 413, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  if (PROBES.has(event.url.pathname)) return resolve(event)

  let runtime
  try {
    runtime = getRuntime()
  } catch (error) {
    if (error instanceof RuntimeUnavailable) {
      return new Response('Docket Cloud is starting. Try again in a moment.', {
        status: 503,
        headers: { 'retry-after': '5', 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    throw error
  }

  const address = clientAddress(event)
  if (address && SIGN_IN.test(event.url.pathname)) {
    const decision = await runtime.limiter.check(signInLimits(address, runtime.signInRule))
    if (!decision.allowed) {
      // The first refusal in a window is audited; repeats answered from memory are not, so a flood cannot fill the log.
      if (!decision.cached) {
        await recordStandalone(event, { action: 'auth.rate-limited', outcome: 'denied', orgId: null, target: [event.url.pathname] })
      }
      return new Response(`Too many sign-in requests from your address. ${rateLimitMessage(decision)}`, {
        status: 429,
        headers: { 'retry-after': String(decision.retryAfterSeconds), 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  }

  // MCP endpoints, and API calls that carry a bearer token (the CLI's), authenticate by the token alone (§3 step 2):
  // no session cookie is read, so no session CSRF token is asked for.
  const bearerOnly =
    event.url.pathname.startsWith('/mcp/') || (event.url.pathname.startsWith('/api/') && /^Bearer\s/i.test(event.request.headers.get('authorization') ?? ''))
  const secret = bearerOnly ? undefined : event.cookies.get(SESSION_COOKIE)
  if (secret) {
    const user = await runtime.router.withPlatform(async (tx) => {
      const session = await readSession(tx, secret)
      if (!session) return null
      const found = await userById(tx, session.userId)
      if (!found || found.kind !== 'human') return null
      return {
        id: found.id,
        login: found.login,
        name: found.name,
        avatarUrl: found.avatarUrl,
        emails: found.emails,
        allowlisted: await isUserAllowlisted(tx, found.id),
      }
    })
    if (user) {
      event.locals.user = user
      event.locals.sessionSecret = secret
      event.locals.csrf = csrfToken(secret)
    } else {
      event.cookies.delete(SESSION_COOKIE, { path: '/' })
    }
  }

  const mutation = !SAFE_METHODS.has(event.request.method)
  // Every mutation a session makes carries the session's CSRF token (§8.1).
  if (mutation && event.locals.sessionSecret) {
    if (!verifyCsrf(event.locals.sessionSecret, await csrfTokenOf(event.request))) {
      await recordStandalone(event, { action: 'web.csrf', outcome: 'denied', orgId: null, target: [event.url.pathname] })
      return new Response('This form expired. Reload the page and try again.', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  }

  const response = await resolve(event, { transformPageChunk: withTheme(event.cookies.get(THEME_COOKIE)) })
  // A local preview may be shown inside a tool's frame; every deployment keeps frame-ancestors 'none'.
  const policy = response.headers.get('content-security-policy')
  if (policy && runtime.frameAncestors !== "'none'") {
    response.headers.set('content-security-policy', withFrameAncestors(policy, runtime.frameAncestors))
  }

  // One audit event per authenticated request, reads included (§10). Routes that change
  // something write theirs in the same transaction; this records the rest.
  if (!event.locals.audited && event.locals.user) {
    try {
      await recordStandalone(event, {
        // A form action's name (`?/invite`) and nothing else of the query string, which a caller controls.
        action: `${event.request.method} ${event.route.id ?? event.url.pathname}${/^\?\/[\w-]+/.exec(event.url.search)?.[0] ?? ''}`,
        outcome: outcomeOf(response.status),
        orgId: event.locals.auditOrgId,
        target: event.locals.auditOrgId ? [] : [event.url.pathname],
      })
    } catch (error) {
      console.error(`audit: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return response
}

export const handleError: HandleServerError = ({ error, event, status }) => {
  if (status >= 500) {
    console.error(`[${event.locals.requestId}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }
  return { message: status === 404 ? 'Not found' : 'Something went wrong.' }
}
