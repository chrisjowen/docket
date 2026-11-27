// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { csrfToken, verifyCsrf } from './csrf.js'
import { authorizeUrl, exchangeCode, fetchIdentity, newAuthorization, type GitHubOAuthConfig } from './github.js'

describe('csrf', () => {
  it('accepts the token for its own session only', () => {
    const token = csrfToken('session-a')
    expect(verifyCsrf('session-a', token)).toBe(true)
    expect(verifyCsrf('session-b', token)).toBe(false)
    expect(verifyCsrf('session-a', '')).toBe(false)
    expect(verifyCsrf('session-a', undefined)).toBe(false)
    expect(verifyCsrf('session-a', `${token}x`)).toBe(false)
  })
})

describe('GitHub sign-in', () => {
  const config = (fetchImpl: typeof fetch): GitHubOAuthConfig => ({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://docket.example/auth/github/callback',
    oauthBase: 'https://gh.test',
    apiBase: 'https://api.gh.test',
    fetch: fetchImpl,
  })

  it('asks for read:user and user:email with an S256 PKCE challenge', () => {
    const auth = newAuthorization()
    expect(auth.challenge).toBe(createHash('sha256').update(auth.verifier).digest('base64url'))
    const url = new URL(authorizeUrl(config(fetch), auth))
    expect(url.origin + url.pathname).toBe('https://gh.test/login/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      scope: 'read:user user:email',
      state: auth.state,
      code_challenge: auth.challenge,
      code_challenge_method: 'S256',
      redirect_uri: 'https://docket.example/auth/github/callback',
    })
  })

  it('exchanges the code with the verifier and reads only verified emails, primary first', async () => {
    const seen: { url: string; body?: unknown; auth?: string | null }[] = []
    const fake: typeof fetch = async (input, init) => {
      const url = String(input)
      seen.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get('authorization'),
      })
      if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'gho_x' })
      if (url.endsWith('/user')) return Response.json({ id: 7, login: 'Alice', name: 'Alice A', avatar_url: 'https://a' })
      return Response.json([
        { email: 'old@x.dev', verified: true, primary: false },
        { email: 'Alice@X.dev', verified: true, primary: true },
        { email: 'unverified@x.dev', verified: false, primary: false },
      ])
    }
    const token = await exchangeCode(config(fake), { code: 'c1', verifier: 'v1' })
    expect(token).toBe('gho_x')
    expect(seen[0]?.body).toMatchObject({ code: 'c1', code_verifier: 'v1', client_secret: 'secret' })
    const identity = await fetchIdentity(config(fake), token)
    expect(identity).toEqual({
      id: 7,
      login: 'Alice',
      name: 'Alice A',
      avatarUrl: 'https://a',
      emails: ['alice@x.dev', 'old@x.dev'],
    })
    expect(seen[1]?.auth).toBe('Bearer gho_x')
  })

  it('falls back to the public email when GitHub refuses /user/emails, and to none without one', async () => {
    const refusing =
      (email: string | null, status: number): typeof fetch =>
      async (input) =>
        String(input).endsWith('/user/emails')
          ? Response.json({ message: 'Resource not accessible by integration' }, { status })
          : Response.json({ id: 9, login: 'bob', name: null, avatar_url: null, email })
    expect((await fetchIdentity(config(refusing('Bob@X.dev', 403)), 'ghu_x')).emails).toEqual(['bob@x.dev'])
    expect((await fetchIdentity(config(refusing(null, 404)), 'ghu_x')).emails).toEqual([])
    await expect(fetchIdentity(config(refusing(null, 500)), 'ghu_x')).rejects.toThrow(/500/)
  })

  it('refuses a code GitHub rejects', async () => {
    const fake: typeof fetch = async () => Response.json({ error: 'bad_verification_code' })
    await expect(exchangeCode(config(fake), { code: 'c', verifier: 'v' })).rejects.toThrow(/bad_verification_code/)
  })
})
