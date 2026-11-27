// SPDX-License-Identifier: AGPL-3.0-only
import { authorizeUrl, newAuthorization } from '@docket/platform-auth'
import { redirect } from '@sveltejs/kit'

import { OAUTH_COOKIE, safeNext } from '$lib/server/signin'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/** Starts GitHub sign-in: a fresh state and PKCE verifier in a short-lived cookie, then off to GitHub. */
export const GET: RequestHandler = ({ cookies, url }) => {
  const { github, secureCookies } = getRuntime()
  if (!github) redirect(303, '/signin?error=unconfigured')
  const authorization = newAuthorization()
  cookies.set(
    OAUTH_COOKIE,
    JSON.stringify({ state: authorization.state, verifier: authorization.verifier, next: safeNext(url.searchParams.get('next')) }),
    { path: '/auth/github', httpOnly: true, secure: secureCookies, sameSite: 'lax', maxAge: 600 },
  )
  redirect(302, authorizeUrl(github, authorization))
}
