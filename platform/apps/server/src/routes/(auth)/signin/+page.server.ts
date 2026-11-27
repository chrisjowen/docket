// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@docket/platform-auth'
import { mayEnterBeta, upsertGitHubUser } from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { auditInput, clientAddress } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { safeNext } from '$lib/server/signin'

import type { Actions, PageServerLoad } from './$types'

const ERRORS: Record<string, string> = {
  unconfigured: 'GitHub sign-in is not set up on this server yet.',
  expired: 'That sign-in link expired. Start again.',
  cancelled: 'Sign-in was cancelled on GitHub.',
  github: 'GitHub did not answer. Try again in a moment.',
}

export const load: PageServerLoad = ({ locals, url }) => {
  const next = safeNext(url.searchParams.get('next'))
  if (locals.user) redirect(303, next)
  const code = url.searchParams.get('error')
  const { github, demo } = getRuntime()
  return {
    next,
    githubReady: github !== null,
    // Only a local preview has one (DOCKET_DEMO_LOGIN).
    demoLogin: demo?.login ?? null,
    error: code ? (ERRORS[code] ?? 'Sign-in failed. Try again.') : null,
  }
}

export const actions: Actions = {
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
