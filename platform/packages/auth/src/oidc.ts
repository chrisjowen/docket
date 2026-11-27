// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose'

/**
 * Sign-in with any OpenID Connect provider (§8.1): Okta, Entra ID, Google,
 * Keycloak, Authentik, Dex and the like. The authorization code flow with
 * PKCE, a state and a nonce; the ID token's signature is checked against the
 * provider's published keys, and its issuer, audience, expiry and nonce
 * against this sign-in. The provider's tokens are used once, to read the
 * identity, and never stored. A person is the provider's issuer and `sub`,
 * never their email: only a verified email is kept, and only for invites and
 * the allowlist.
 */
export interface OidcProviderConfig {
  /** The provider's name in config, in its routes (`/auth/oidc/<name>`) and in the logins it gives (`jo.<name>`). */
  name: string
  /** What the sign-in button says: "Continue with <label>". */
  label: string
  /** The issuer URL, exactly as the provider's discovery document gives it. */
  issuer: string
  clientId: string
  clientSecret: string
  /** `<origin>/auth/oidc/<name>/callback`. */
  redirectUri: string
  /** Asked for beside `openid`; default `profile email`. */
  scopes: readonly string[]
  /** Plain http:// endpoints: a provider on this machine, for a local preview or a test. Refused otherwise. */
  allowHttp?: boolean
  fetch?: typeof fetch
}

export class OidcSignInError extends Error {
  override name = 'OidcSignInError'
}

/** What a provider's discovery document says, as far as sign-in needs it. */
export interface OidcMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string | null
  jwksUri: string
  /** `client_secret_basic` unless the provider takes only `client_secret_post`. */
  tokenAuth: 'client_secret_basic' | 'client_secret_post'
}

/** The person an OIDC sign-in vouched for. */
export interface OidcIdentity {
  issuer: string
  subject: string
  /** `preferred_username`, if the provider gives one. */
  username: string | null
  name: string | null
  avatarUrl: string | null
  /** The email, lowercase, only when the provider says it is verified. */
  emails: string[]
}

const TIMEOUT_MS = 10_000
const METADATA_TTL_MS = 60 * 60 * 1000
const CLOCK_TOLERANCE_S = 60

const base64url = (bytes: Buffer) => bytes.toString('base64url')

/** A random `state` and `nonce`, and a PKCE verifier with its S256 challenge. */
export function newOidcAuthorization(): { state: string; nonce: string; verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return {
    state: base64url(randomBytes(24)),
    nonce: base64url(randomBytes(24)),
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
  }
}

function endpoint(config: OidcProviderConfig, value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new OidcSignInError(`${config.name}: the discovery document has no ${what}`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OidcSignInError(`${config.name}: the discovery document's ${what} is not a URL`)
  }
  if (url.protocol !== 'https:' && !(config.allowHttp && url.protocol === 'http:')) {
    throw new OidcSignInError(`${config.name}: the provider's ${what} is not https://`)
  }
  return value
}

async function getJson(config: OidcProviderConfig, url: string, what: string, init: RequestInit = {}): Promise<unknown> {
  const response = await (config.fetch ?? fetch)(url, { ...init, headers: { accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new OidcSignInError(`${config.name}: ${what} answered ${response.status}`)
  return response.json()
}

const metadataCache = new Map<string, { at: number; metadata: OidcMetadata }>()
const keysCache = new Map<string, { at: number; keys: JSONWebKeySet }>()

/** The provider's discovery document (`<issuer>/.well-known/openid-configuration`), cached for an hour. */
export async function discoverOidc(config: OidcProviderConfig, now = Date.now()): Promise<OidcMetadata> {
  const cached = metadataCache.get(config.issuer)
  if (cached && now - cached.at < METADATA_TTL_MS) return cached.metadata
  const issuer = endpoint(config, config.issuer, 'issuer')
  const document = (await getJson(config, `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, 'discovery')) as Record<string, unknown>
  // The issuer it states is the one every ID token must carry, and must be the one configured (OIDC Discovery §4.3).
  if (document.issuer !== config.issuer) {
    throw new OidcSignInError(`${config.name}: the provider says its issuer is ${JSON.stringify(document.issuer)}, not ${config.issuer}`)
  }
  const methods = Array.isArray(document.token_endpoint_auth_methods_supported) ? document.token_endpoint_auth_methods_supported : ['client_secret_basic']
  const metadata: OidcMetadata = {
    issuer: config.issuer,
    authorizationEndpoint: endpoint(config, document.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: endpoint(config, document.token_endpoint, 'token_endpoint'),
    userinfoEndpoint: document.userinfo_endpoint === undefined ? null : endpoint(config, document.userinfo_endpoint, 'userinfo_endpoint'),
    jwksUri: endpoint(config, document.jwks_uri, 'jwks_uri'),
    tokenAuth: methods.includes('client_secret_basic') || !methods.includes('client_secret_post') ? 'client_secret_basic' : 'client_secret_post',
  }
  metadataCache.set(config.issuer, { at: now, metadata })
  return metadata
}

/** Where the browser goes to sign in. */
export function oidcAuthorizeUrl(config: OidcProviderConfig, metadata: OidcMetadata, input: { state: string; nonce: string; challenge: string }): string {
  const url = new URL(metadata.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', ['openid', ...config.scopes.filter((scope) => scope !== 'openid')].join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** The provider's signing keys, cached for an hour and fetched again once when a token names a key not in them. */
async function verifyIdToken(config: OidcProviderConfig, metadata: OidcMetadata, idToken: string, nonce: string): Promise<JWTPayload> {
  const verify = async (keys: JSONWebKeySet) =>
    (
      await jwtVerify(idToken, createLocalJWKSet(keys), {
        issuer: metadata.issuer,
        audience: config.clientId,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ['sub', 'exp', 'iat'],
        algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'],
      })
    ).payload
  const fetchKeys = async () => {
    const keys = (await getJson(config, metadata.jwksUri, 'jwks_uri')) as JSONWebKeySet
    if (!keys || !Array.isArray(keys.keys)) throw new OidcSignInError(`${config.name}: jwks_uri gave no keys`)
    keysCache.set(metadata.jwksUri, { at: Date.now(), keys })
    return keys
  }
  const cached = keysCache.get(metadata.jwksUri)
  let payload: JWTPayload
  try {
    payload = await verify(cached && Date.now() - cached.at < METADATA_TTL_MS ? cached.keys : await fetchKeys())
  } catch (error) {
    // A key the cache has not seen yet: the provider rotated its keys.
    if (!cached || (error as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw new OidcSignInError(`${config.name}: the ID token was refused: ${(error as Error).message}`)
    try {
      payload = await verify(await fetchKeys())
    } catch (again) {
      throw new OidcSignInError(`${config.name}: the ID token was refused: ${(again as Error).message}`)
    }
  }
  if (payload.nonce !== nonce) throw new OidcSignInError(`${config.name}: the ID token's nonce is not this sign-in's`)
  // With several audiences, the token must have been issued to this client (OIDC Core §3.1.3.7).
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) {
    throw new OidcSignInError(`${config.name}: the ID token was issued to another client`)
  }
  return payload
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * Exchanges the callback's code for tokens, checks the ID token, and reads the
 * person it names; the userinfo endpoint fills in what the ID token leaves out.
 */
export async function oidcSignIn(config: OidcProviderConfig, metadata: OidcMetadata, input: { code: string; verifier: string; nonce: string }): Promise<OidcIdentity> {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: config.redirectUri, code_verifier: input.verifier })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (metadata.tokenAuth === 'client_secret_basic') {
    // RFC 6749 §2.3.1: each half form-encoded before the base64.
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`
  } else {
    form.set('client_id', config.clientId)
    form.set('client_secret', config.clientSecret)
  }
  const tokens = (await getJson(config, metadata.tokenEndpoint, 'the token endpoint', { method: 'POST', headers, body: form.toString() })) as { id_token?: unknown; access_token?: unknown }
  if (typeof tokens.id_token !== 'string') throw new OidcSignInError(`${config.name}: the token endpoint gave no ID token`)
  const claims: Record<string, unknown> = { ...(await verifyIdToken(config, metadata, tokens.id_token, input.nonce)) }
  const subject = text(claims.sub)
  if (!subject) throw new OidcSignInError(`${config.name}: the ID token has no subject`)

  if (metadata.userinfoEndpoint && typeof tokens.access_token === 'string' && (claims.email === undefined || claims.name === undefined)) {
    const info = (await getJson(config, metadata.userinfoEndpoint, 'userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })) as Record<string, unknown>
    // Userinfo about someone else is refused outright (OIDC Core §5.3.2).
    if (info.sub !== subject) throw new OidcSignInError(`${config.name}: userinfo is about another subject`)
    for (const [claim, value] of Object.entries(info)) if (claims[claim] === undefined) claims[claim] = value
  }

  const email = text(claims.email)?.toLowerCase() ?? null
  const verified = claims.email_verified === true || claims.email_verified === 'true'
  const picture = text(claims.picture)
  return {
    issuer: metadata.issuer,
    subject,
    username: text(claims.preferred_username),
    name: text(claims.name) ?? ([text(claims.given_name), text(claims.family_name)].filter(Boolean).join(' ') || null),
    avatarUrl: picture && /^https:\/\//.test(picture) ? picture : null,
    emails: email && verified ? [email] : [],
  }
}
