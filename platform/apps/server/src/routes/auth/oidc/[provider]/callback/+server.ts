// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { SESSION_COOKIE, createSession, discoverOidc, oidcSignIn, sessionCookieOptions } from '@docket/platform-auth'
import { mayEnter, oidcLogin, resolveIdentity, type ExternalIdentity } from '@docket/platform-tenancy'
import { redirect } from '@sveltejs/kit'

import { auditInput, clientAddress, recordStandalone } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { OIDC_COOKIE, safeNext } from '$lib/server/signin'

import type { RequestHandler } from './$types'

/**
 * An OpenID Connect provider's redirect back (§8.1). The state must match the
 * cookie set when sign-in started, and the ID token this sign-in's nonce. The
 * person is the provider's issuer and subject, resolved to a user like every
 * other sign-in; they get a session when that identity may enter (a member
 * already, a verified email on the allowlist, or an invite to one), and are
 * told they are not invited otherwise.
 */
export const GET: RequestHandler = async (event) => {
  const { cookies, params, url } = event
  const { oidc, router, secureCookies } = getRuntime()
  const provider = oidc.get(params.provider)
  if (!provider) redirect(303, '/signin?error=unconfigured')

  const path = `/auth/oidc/${provider.name}`
  const raw = cookies.get(OIDC_COOKIE)
  cookies.delete(OIDC_COOKIE, { path })
  let started: { state?: unknown; nonce?: unknown; verifier?: unknown; next?: unknown } = {}
  try {
    started = raw ? JSON.parse(raw) : {}
  } catch {
    started = {}
  }
  if (url.searchParams.get('error') === 'access_denied') redirect(303, '/signin?error=cancelled')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || typeof started.state !== 'string' || started.state !== state || typeof started.verifier !== 'string' || typeof started.nonce !== 'string') {
    await recordStandalone(event, { action: 'auth.signin', outcome: 'invalid', orgId: null, target: [`oidc:${provider.name}`, 'state-mismatch'] })
    redirect(303, '/signin?error=expired')
  }

  let identity: Extract<ExternalIdentity, { issuer: string }>
  try {
    const found = await oidcSignIn(provider, await discoverOidc(provider), { code, verifier: started.verifier, nonce: started.nonce })
    identity = {
      provider: 'oidc',
      issuer: found.issuer,
      subject: found.subject,
      login: oidcLogin(provider.name, { username: found.username, email: found.emails[0] ?? null }),
      name: found.name,
      avatarUrl: found.avatarUrl,
      emails: found.emails,
    }
  } catch (error) {
    console.error(`[${event.locals.requestId}] OIDC sign-in (${provider.name}): ${error instanceof Error ? error.message : String(error)}`)
    await recordStandalone(event, { action: 'auth.signin', outcome: 'error', orgId: null, target: [`oidc:${provider.name}`] })
    redirect(303, '/signin?error=provider')
  }

  const session = await router.withPlatform(async (tx) => {
    const target = `oidc:${provider.name}:${identity.subject}`
    if (!(await mayEnter(tx, identity))) {
      await audit(tx, auditInput(event, { action: 'auth.signin', outcome: 'denied', orgId: null, target: [target] }))
      return null
    }
    const user = await resolveIdentity(tx, identity)
    const created = await createSession(tx, { userId: user.id, ip: clientAddress(event), userAgent: event.request.headers.get('user-agent') })
    await audit(tx, { ...auditInput(event, { action: 'auth.signin', outcome: 'ok', orgId: null, target: [target] }), actor: `user:${user.id}` })
    return created
  })
  event.locals.audited = true
  if (!session) redirect(303, '/signin?error=not-invited')
  cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions({ secure: secureCookies, expiresAt: session.expiresAt }))
  redirect(303, safeNext(typeof started.next === 'string' ? started.next : null))
}
