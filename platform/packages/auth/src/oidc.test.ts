// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import { OidcSignInError, discoverOidc, newOidcAuthorization, oidcAuthorizeUrl, oidcSignIn, type OidcProviderConfig } from './oidc.js'

/** A fake OpenID provider: discovery, keys, a token endpoint that signs whatever ID token the test asks for, and userinfo. */
interface FakeProvider {
  issuer: string
  fetch: typeof fetch
  calls: { url: string; init: RequestInit | undefined }[]
  /** The ID token's claims the next token request answers with. */
  claims: Record<string, unknown>
  userinfo: Record<string, unknown> | null
  sign(claims: Record<string, unknown>, key?: CryptoKey, kid?: string): Promise<string>
  /** Publishes a new signing key; tokens are signed with it from now on. */
  rotate(): Promise<void>
  discovery: Record<string, unknown>
}

let issuerCount = 0

async function fakeProvider(): Promise<FakeProvider> {
  const issuer = `https://idp${++issuerCount}.example.com`
  let key = await generateKeyPair('RS256')
  let kid = 'k1'
  let jwks: JWK[] = [{ ...(await exportJWK(key.publicKey)), kid, alg: 'RS256', use: 'sig' }]
  const provider: FakeProvider = {
    issuer,
    calls: [],
    claims: {},
    userinfo: null,
    discovery: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
    },
    sign: (claims, signWith = key.privateKey, keyId = kid) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: keyId }).sign(signWith),
    async rotate() {
      key = await generateKeyPair('RS256')
      kid = `k${jwks.length + 1}`
      jwks = [...jwks, { ...(await exportJWK(key.publicKey)), kid, alg: 'RS256', use: 'sig' }]
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      provider.calls.push({ url, init })
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url === `${issuer}/.well-known/openid-configuration`) return json(provider.discovery)
      if (url === `${issuer}/jwks`) return json({ keys: jwks })
      if (url === `${issuer}/token`) return json({ access_token: 'access', token_type: 'Bearer', id_token: await provider.sign(provider.claims) })
      if (url === `${issuer}/userinfo`) return provider.userinfo ? json(provider.userinfo) : json({ error: 'nope' }, 401)
      return json({ error: 'not found' }, 404)
    }) as typeof fetch,
  }
  return provider
}

const now = () => Math.floor(Date.now() / 1000)

describe('OIDC sign-in', () => {
  let idp: FakeProvider
  let config: OidcProviderConfig

  beforeAll(async () => {
    idp = await fakeProvider()
    config = {
      name: 'okta',
      label: 'Okta',
      issuer: idp.issuer,
      clientId: 'docket',
      clientSecret: 'client-secret',
      redirectUri: 'https://docket.example/auth/oidc/okta/callback',
      scopes: ['profile', 'email'],
      fetch: idp.fetch,
    }
  })

  const claims = (nonce: string, extra: Record<string, unknown> = {}) => ({
    iss: idp.issuer,
    aud: 'docket',
    sub: 'user-123',
    iat: now(),
    exp: now() + 300,
    nonce,
    preferred_username: 'jo',
    name: 'Jo Bloggs',
    email: 'Jo@Example.com',
    email_verified: true,
    ...extra,
  })

  it('sends the browser to the provider with openid, a state, a nonce and an S256 challenge', async () => {
    const auth = newOidcAuthorization()
    expect(auth.challenge).toBe(createHash('sha256').update(auth.verifier).digest('base64url'))
    const metadata = await discoverOidc(config)
    const url = new URL(oidcAuthorizeUrl(config, metadata, auth))
    expect(url.origin + url.pathname).toBe(`${idp.issuer}/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'docket',
      redirect_uri: config.redirectUri,
      scope: 'openid profile email',
      state: auth.state,
      nonce: auth.nonce,
      code_challenge: auth.challenge,
      code_challenge_method: 'S256',
    })
  })

  it('reads the person from a signed ID token: issuer and subject, and the email only when verified', async () => {
    const metadata = await discoverOidc(config)
    idp.claims = claims('n1')
    const identity = await oidcSignIn(config, metadata, { code: 'code', verifier: 'verifier', nonce: 'n1' })
    expect(identity).toEqual({ issuer: idp.issuer, subject: 'user-123', username: 'jo', name: 'Jo Bloggs', avatarUrl: null, emails: ['jo@example.com'] })

    const token = idp.calls.findLast((call) => call.url.endsWith('/token'))
    expect(new Headers(token?.init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('docket:client-secret').toString('base64')}`)
    expect(Object.fromEntries(new URLSearchParams(String(token?.init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'code',
      redirect_uri: config.redirectUri,
      code_verifier: 'verifier',
    })

    idp.claims = claims('n2', { email_verified: false })
    expect((await oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'n2' })).emails).toEqual([])
  })

  it('refuses a token for another nonce, audience or issuer, an expired one, and one signed by another key', async () => {
    const metadata = await discoverOidc(config)
    const signIn = () => oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'mine' })
    idp.claims = claims('theirs')
    await expect(signIn()).rejects.toThrow(/nonce/)
    idp.claims = claims('mine', { aud: 'another-client' })
    await expect(signIn()).rejects.toThrow(OidcSignInError)
    idp.claims = claims('mine', { iss: 'https://evil.example.com' })
    await expect(signIn()).rejects.toThrow(OidcSignInError)
    idp.claims = claims('mine', { exp: now() - 3600, iat: now() - 7200 })
    await expect(signIn()).rejects.toThrow(OidcSignInError)
    idp.claims = claims('mine', { aud: ['docket', 'other'], azp: 'other' })
    await expect(signIn()).rejects.toThrow(/another client/)

    const forged = await (await generateKeyPair('RS256')).privateKey
    const original = idp.sign
    idp.sign = (body) => original(body, forged)
    idp.claims = claims('mine')
    await expect(signIn()).rejects.toThrow(OidcSignInError)
    idp.sign = original
  })

  it('fetches the keys again when the provider rotates them', async () => {
    const metadata = await discoverOidc(config)
    idp.claims = claims('r1')
    await oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'r1' })
    await idp.rotate()
    idp.claims = claims('r2')
    expect((await oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'r2' })).subject).toBe('user-123')
  })

  it('fills what the ID token leaves out from userinfo, about the same subject only', async () => {
    const metadata = await discoverOidc(config)
    idp.claims = claims('u1', { email: undefined, email_verified: undefined, name: undefined, preferred_username: undefined })
    idp.userinfo = { sub: 'user-123', email: 'jo@example.com', email_verified: true, name: 'Jo', picture: 'https://cdn.example.com/jo.png' }
    expect(await oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'u1' })).toMatchObject({ name: 'Jo', emails: ['jo@example.com'], avatarUrl: 'https://cdn.example.com/jo.png' })
    idp.userinfo = { sub: 'someone-else', email: 'boss@example.com', email_verified: true }
    await expect(oidcSignIn(config, metadata, { code: 'code', verifier: 'v', nonce: 'u1' })).rejects.toThrow(/another subject/)
    idp.userinfo = null
  })

  it('refuses a provider whose discovery names another issuer, or plain http://', async () => {
    const other = await fakeProvider()
    other.discovery.issuer = 'https://not-it.example.com'
    await expect(discoverOidc({ ...config, issuer: other.issuer, fetch: other.fetch })).rejects.toThrow(/issuer/)
    const plain = await fakeProvider()
    plain.discovery.token_endpoint = 'http://insecure.example.com/token'
    await expect(discoverOidc({ ...config, issuer: plain.issuer, fetch: plain.fetch })).rejects.toThrow(/https/)
  })

  it('posts the client secret in the form when the provider takes only that', async () => {
    const post = await fakeProvider()
    post.discovery.token_endpoint_auth_methods_supported = ['client_secret_post']
    const postConfig = { ...config, issuer: post.issuer, fetch: post.fetch }
    const metadata = await discoverOidc(postConfig)
    expect(metadata.tokenAuth).toBe('client_secret_post')
    post.claims = { ...claims('p1'), iss: post.issuer }
    await oidcSignIn(postConfig, metadata, { code: 'code', verifier: 'v', nonce: 'p1' })
    const token = post.calls.findLast((call) => call.url.endsWith('/token'))
    expect(new Headers(token?.init?.headers).get('authorization')).toBeNull()
    expect(new URLSearchParams(String(token?.init?.body)).get('client_secret')).toBe('client-secret')
  })
})
