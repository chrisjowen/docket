// SPDX-License-Identifier: AGPL-3.0-only
import { discoverOidc, newOidcAuthorization, oidcAuthorizeUrl } from '@docket/platform-auth'
import { redirect } from '@sveltejs/kit'

import { getRuntime } from '$lib/server/runtime'
import { OIDC_COOKIE, safeNext } from '$lib/server/signin'

import type { RequestHandler } from './$types'

/** Starts sign-in with an OpenID Connect provider: a fresh state, nonce and PKCE verifier in a short-lived cookie, then off to the provider. */
export const GET: RequestHandler = async ({ cookies, params, url, locals }) => {
  const { oidc, secureCookies } = getRuntime()
  const provider = oidc.get(params.provider)
  if (!provider) redirect(303, '/signin?error=unconfigured')
  let metadata
  try {
    metadata = await discoverOidc(provider)
  } catch (error) {
    console.error(`[${locals.requestId}] OIDC sign-in (${provider.name}): ${error instanceof Error ? error.message : String(error)}`)
    redirect(303, '/signin?error=provider')
  }
  const authorization = newOidcAuthorization()
  cookies.set(
    OIDC_COOKIE,
    JSON.stringify({
      state: authorization.state,
      nonce: authorization.nonce,
      verifier: authorization.verifier,
      next: safeNext(url.searchParams.get('next')),
    }),
    { path: `/auth/oidc/${provider.name}`, httpOnly: true, secure: secureCookies, sameSite: 'lax', maxAge: 600 },
  )
  redirect(302, oidcAuthorizeUrl(provider, metadata, authorization))
}
