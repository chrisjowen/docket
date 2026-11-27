// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'

import type { GitHubIdentity } from '@docket/platform-tenancy'

/**
 * GitHub web sign-in (§8.1): the OAuth web flow with PKCE, scopes
 * `read:user user:email` only. The GitHub access token is used once, to read
 * the identity, and never stored.
 */
export interface GitHubOAuthConfig {
  clientId: string
  clientSecret: string
  /** `<origin>/auth/github/callback`. */
  redirectUri: string
  /** `https://github.com`, or a fake in tests. */
  oauthBase?: string
  /** `https://api.github.com`, or a fake in tests. */
  apiBase?: string
  fetch?: typeof fetch
}

export const GITHUB_SCOPES = 'read:user user:email'

export class GitHubSignInError extends Error {
  override name = 'GitHubSignInError'
}

const base64url = (bytes: Buffer) => bytes.toString('base64url')

/** A random `state` and a PKCE verifier with its S256 challenge. */
export function newAuthorization(): { state: string; verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return {
    state: base64url(randomBytes(24)),
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
  }
}

export function authorizeUrl(config: GitHubOAuthConfig, input: { state: string; challenge: string }): string {
  const url = new URL('/login/oauth/authorize', config.oauthBase ?? 'https://github.com')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', GITHUB_SCOPES)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('allow_signup', 'false')
  return url.toString()
}

async function json(response: Response, what: string): Promise<unknown> {
  if (!response.ok) throw new GitHubSignInError(`GitHub ${what} answered ${response.status}`)
  return response.json()
}

/** Exchanges the callback's code for a GitHub access token. */
export async function exchangeCode(
  config: GitHubOAuthConfig,
  input: { code: string; verifier: string },
): Promise<string> {
  const doFetch = config.fetch ?? fetch
  const body = (await json(
    await doFetch(new URL('/login/oauth/access_token', config.oauthBase ?? 'https://github.com'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        redirect_uri: config.redirectUri,
        code_verifier: input.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    }),
    'token exchange',
  )) as { access_token?: unknown; error?: unknown }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new GitHubSignInError(`GitHub refused the code: ${typeof body.error === 'string' ? body.error : 'no token'}`)
  }
  return body.access_token
}

/** Reads the signed-in user and their verified emails, primary first. */
export async function fetchIdentity(config: GitHubOAuthConfig, accessToken: string): Promise<GitHubIdentity> {
  const doFetch = config.fetch ?? fetch
  const api = config.apiBase ?? 'https://api.github.com'
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${accessToken}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'docket-cloud',
  }
  const user = (await json(
    await doFetch(new URL('/user', api), { headers, signal: AbortSignal.timeout(10_000) }),
    '/user',
  )) as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown; email?: unknown }
  if (typeof user.id !== 'number' || typeof user.login !== 'string') {
    throw new GitHubSignInError('GitHub /user had no id or login')
  }
  // A GitHub App without the "Email addresses" permission is refused /user/emails;
  // the profile's public email (GitHub only lets a verified one be public) stands in.
  const listed = await doFetch(new URL('/user/emails', api), { headers, signal: AbortSignal.timeout(10_000) })
  const emails = (
    listed.status === 403 || listed.status === 404
      ? typeof user.email === 'string' && user.email
        ? [{ email: user.email, verified: true, primary: true }]
        : []
      : await json(listed, '/user/emails')
  ) as { email?: unknown; verified?: unknown; primary?: unknown }[]
  const verified = (Array.isArray(emails) ? emails : [])
    .filter((entry) => entry.verified === true && typeof entry.email === 'string')
    .sort((a, b) => Number(b.primary === true) - Number(a.primary === true))
    .map((entry) => (entry.email as string).toLowerCase())
  return {
    id: user.id,
    login: user.login,
    name: typeof user.name === 'string' && user.name ? user.name : null,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
    emails: verified,
  }
}
