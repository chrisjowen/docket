// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import {
  SESSION_COOKIE,
  createSession,
  exchangeCode,
  fetchIdentity,
  hashSecret,
  newSecret,
  sessionCookieOptions,
} from '@docket/platform-auth'
import { claimWaitlistInvite, joinWaitlistWithGitHub, mayEnter, resolveIdentity } from '@docket/platform-tenancy'
import { redirect } from '@sveltejs/kit'

import { completeLink, pendingLinkOf } from '$lib/server/github-link'
import { auditInput, clientAddress, recordStandalone } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { OAUTH_COOKIE, PENDING_COOKIE, safeNext } from '$lib/server/signin'

import type { RequestHandler } from './$types'

/**
 * GitHub's redirect back (§8.1), for sign-in and for linking an installation
 * of the GitHub App to an org. The state must match the cookie set when
 * sign-in started. An identity on the beta list, with a verified email on the
 * sign-in allowlist, or holding an open invite, gets a session as the user
 * every sign-in provider resolves to; anyone else joins the beta waitlist and sees the
 * invite-only page. An invited waitlist entry with one of the identity's
 * verified emails puts its login on the beta list first.
 */
export const GET: RequestHandler = async (event) => {
  const { cookies, url } = event
  const { github, router, secureCookies } = getRuntime()
  if (!github) redirect(303, '/signin?error=unconfigured')

  const raw = cookies.get(OAUTH_COOKIE)
  cookies.delete(OAUTH_COOKIE, { path: '/auth/github' })
  let started: { state?: unknown; verifier?: unknown; next?: unknown; link?: unknown } = {}
  try {
    started = raw ? JSON.parse(raw) : {}
  } catch {
    started = {}
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (url.searchParams.get('error') === 'access_denied') redirect(303, '/signin?error=cancelled')
  if (!code || !state || typeof started.state !== 'string' || started.state !== state || typeof started.verifier !== 'string') {
    await recordStandalone(event, { action: 'auth.signin', outcome: 'invalid', orgId: null, target: ['github:state-mismatch'] })
    redirect(303, '/signin?error=expired')
  }

  // The second half of linking a GitHub App installation, not a sign-in (§14.1).
  const link = pendingLinkOf(started)
  if (link) return completeLink(event, link, code, started.verifier)

  let identity
  try {
    identity = await fetchIdentity(github, await exchangeCode(github, { code, verifier: started.verifier }))
  } catch (error) {
    console.error(`[${event.locals.requestId}] GitHub sign-in: ${error instanceof Error ? error.message : String(error)}`)
    await recordStandalone(event, { action: 'auth.signin', outcome: 'error', orgId: null, target: ['github'] })
    redirect(303, '/signin?error=github')
  }

  const signedIn = await router.withPlatform(async (tx) => {
    if (await claimWaitlistInvite(tx, identity)) {
      await audit(tx, auditInput(event, { action: 'waitlist.claim', outcome: 'ok', orgId: null, target: [`github:${identity.login}`] }))
    }
    if (!(await mayEnter(tx, { provider: 'github', github: identity }))) {
      const pending = newSecret()
      await tx.query(
        `INSERT INTO platform.access_requests (id_hash, github_id, github_login, email) VALUES ($1, $2, $3, $4)`,
        [hashSecret(pending), identity.id, identity.login, identity.emails[0] ?? null],
      )
      await audit(tx, auditInput(event, { action: 'auth.signin', outcome: 'denied', orgId: null, target: [`github:${identity.login}`] }))
      // Signing in is how someone not yet invited joins the waitlist; it grants nothing.
      const joined = await joinWaitlistWithGitHub(tx, identity)
      await audit(
        tx,
        auditInput(event, {
          action: 'waitlist.join',
          outcome: 'ok',
          orgId: null,
          target: [`waitlist:${joined.id}`, joined.created ? 'via:github' : 'existing', `github:${identity.login}`],
        }),
      )
      return { kind: 'pending' as const, pending }
    }
    const user = await resolveIdentity(tx, { provider: 'github', github: identity })
    const session = await createSession(tx, {
      userId: user.id,
      ip: clientAddress(event),
      userAgent: event.request.headers.get('user-agent'),
    })
    await audit(tx, {
      ...auditInput(event, { action: 'auth.signin', outcome: 'ok', orgId: null, target: [`github:${identity.login}`] }),
      actor: `user:${user.id}`,
    })
    return { kind: 'session' as const, session }
  })
  event.locals.audited = true

  if (signedIn.kind === 'pending') {
    cookies.set(PENDING_COOKIE, signedIn.pending, {
      path: '/signin',
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: 3600,
    })
    redirect(303, '/signin/invite-only')
  }
  cookies.set(SESSION_COOKIE, signedIn.session.id, sessionCookieOptions({ secure: secureCookies, expiresAt: signedIn.session.expiresAt }))
  redirect(303, safeNext(typeof started.next === 'string' ? started.next : null))
}
