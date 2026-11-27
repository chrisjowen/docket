// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { SESSION_COOKIE, createSession, passwordSignIn, sessionCookieOptions } from '@docket/platform-auth'
import { passwordLimits, rateLimitMessage } from '@docket/platform-limits'
import { mayEnterBeta, normaliseOtherLogin, upsertGitHubUser } from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { auditInput, clientAddress } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { safeNext } from '$lib/server/signin'

import type { Actions, PageServerLoad } from './$types'

const ERRORS: Record<string, string> = {
  unconfigured: 'That sign-in is not set up on this server.',
  expired: 'That sign-in link expired. Start again.',
  cancelled: 'Sign-in was cancelled.',
  github: 'GitHub did not answer. Try again in a moment.',
  provider: 'Your sign-in provider did not answer as expected. Try again in a moment.',
  'not-invited': 'You are signed in with your provider, but not invited to this server. Ask an administrator for an invite.',
}

export const load: PageServerLoad = ({ locals, url }) => {
  const next = safeNext(url.searchParams.get('next'))
  if (locals.user) redirect(303, next)
  const code = url.searchParams.get('error')
  const { github, oidc, password, demo } = getRuntime()
  return {
    next,
    githubReady: github !== null,
    oidc: [...oidc.values()].map((provider) => ({ name: provider.name, label: provider.label })),
    password,
    // Only a local preview has one (DOCKET_DEMO_LOGIN).
    demoLogin: demo?.login ?? null,
    error: code ? (ERRORS[code] ?? 'Sign-in failed. Try again.') : null,
  }
}

export const actions: Actions = {
  /** Password sign-in, for the people the operator lists. An unknown login and a wrong password get the same answer. */
  password: async (event) => {
    const { password, router, limiter, secureCookies } = getRuntime()
    if (!password) return fail(404, { passwordProblem: 'There is no password sign-in here.', login: '' })
    const form = await event.request.formData()
    const login = String(form.get('login') ?? '').trim().toLowerCase()
    const secret = String(form.get('password') ?? '')
    if (!normaliseOtherLogin(login) || !secret) return fail(400, { passwordProblem: 'Enter your login and password.', login })
    const decision = await limiter.check(passwordLimits(login))
    if (!decision.allowed) return fail(429, { passwordProblem: `Too many attempts for this login. ${rateLimitMessage(decision)}`, login })
    const session = await router.withPlatform(async (tx) => {
      const user = await passwordSignIn(tx, { login, password: secret })
      if (!user) {
        await audit(tx, auditInput(event, { action: 'auth.signin', outcome: 'denied', orgId: null, target: [`password:${login}`] }))
        return null
      }
      const created = await createSession(tx, { userId: user.id, ip: clientAddress(event), userAgent: event.request.headers.get('user-agent') })
      await audit(tx, { ...auditInput(event, { action: 'auth.signin', outcome: 'ok', orgId: null, target: [`password:${login}`] }), actor: `user:${user.id}` })
      return created
    })
    event.locals.audited = true
    if (!session) return fail(403, { passwordProblem: 'That login and password do not match.', login })
    event.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions({ secure: secureCookies, expiresAt: session.expiresAt }))
    redirect(303, safeNext(String(form.get('next') ?? '/')))
  },
  /** A local preview's one-click demo sign-in, as the GitHub user it names. Absent in every deployment. */
  demo: async (event) => {
    const { demo, router, secureCookies } = getRuntime()
    if (!demo) return fail(404, { demoProblem: 'There is no demo sign-in here.' })
    const form = await event.request.formData()
    const identity = { id: demo.githubId, login: demo.login, name: null, avatarUrl: null, emails: [] }
    const session = await router.withPlatform(async (tx) => {
      if (!(await mayEnterBeta(tx, identity))) return null
      const user = await upsertGitHubUser(tx, identity)
      const created = await createSession(tx, { userId: user.id, ip: clientAddress(event), userAgent: event.request.headers.get('user-agent') })
      await audit(tx, {
        ...auditInput(event, { action: 'auth.signin', outcome: 'ok', orgId: null, target: [`demo:${demo.login}`] }),
        actor: `user:${user.id}`,
      })
      return created
    })
    event.locals.audited = true
    if (!session) return fail(403, { demoProblem: `${demo.login} is not on this preview's beta list (DOCKET_BETA_ALLOWLIST).` })
    event.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions({ secure: secureCookies, expiresAt: session.expiresAt }))
    redirect(303, safeNext(String(form.get('next') ?? '/')))
  },
}
