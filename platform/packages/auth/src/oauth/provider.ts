// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { Tx } from '@docket/platform-tenancy'
import Provider, { errors, type Adapter, type AdapterPayload, type Configuration, type KoaContextWithOIDC } from 'oidc-provider'

import { SCOPES } from '../scopes.js'
import { notifyRevoked } from '../tokens/revocation.js'
import { cimdFetchAllowed } from './cimd.js'

/**
 * The OAuth 2.1 authorization server MCP clients sign in through (§8.2):
 * `oidc-provider` with PKCE (S256 only), resource indicators (RFC 8707),
 * Dynamic Client Registration, Client ID Metadata Documents with an SSRF
 * guard, opaque 15-minute access tokens bound to one workspace's MCP URL,
 * and rotating 30-day refresh tokens. The user's sign-in is the web session
 * (GitHub); the consent screen is the web app's `/oauth/consent/{uid}`.
 * `docket cloud login` signs in with the device authorization grant
 * (RFC 8628) as the pre-registered public client `docket-cli`.
 */
export const OAUTH_PATHS = {
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  registration: '/oauth/register',
  revocation: '/oauth/revoke',
  jwks: '/oauth/jwks',
  device_authorization: '/oauth/device/auth',
  // Where the user enters the code; the device flow resumes at /oauth/device/{uid}.
  code_verification: '/oauth/device',
} as const

export type OAuthEndpoint = keyof typeof OAUTH_PATHS

/** The endpoints `oidc-provider` answers; everything else under /oauth is the web app's. */
export function isProviderPath(pathname: string): boolean {
  return providerEndpoint(pathname) !== null
}

/** Which provider endpoint a path is, the longest match first (`/oauth/device/auth` before `/oauth/device`). */
export function providerEndpoint(pathname: string): OAuthEndpoint | null {
  let found: OAuthEndpoint | null = null
  for (const [endpoint, path] of Object.entries(OAUTH_PATHS) as [OAuthEndpoint, string][]) {
    if ((pathname === path || pathname.startsWith(`${path}/`)) && (!found || path.length > OAUTH_PATHS[found].length)) found = endpoint
  }
  return found
}

export const ACCESS_TOKEN_TTL_S = 15 * 60
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
/** The device grant's client: docket's CLI, registered by the server itself rather than through DCR. */
export const CLI_CLIENT_ID = 'docket-cli'
/** How often a device may poll the token endpoint (RFC 8628 §3.2); faster is answered `slow_down`. */
export const DEVICE_POLL_INTERVAL_S = 5
/** How long a device code waits for the user to approve it. */
const DEVICE_CODE_TTL_S = 10 * 60

type Platform = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

export interface OAuthServerOptions {
  /** The public origin: the issuer (`https://docket.example.com`). */
  issuer: string
  platform: Platform
  /** Signs the authorization server's cookies; derive with `oauthCookieKeys`. */
  cookieKeys: string[]
  /**
   * The org and workspace a canonical MCP URL names, or null when it names
   * none: a docket's, or an account's (tenancy v2 §4), whose workspace is null.
   */
  resourceFor(url: string): Promise<{ orgId: string; workspaceId: string | null } | null>
  /** Whether a user id is a human who may hold OAuth grants. */
  isHuman(userId: string): Promise<boolean>
  /**
   * Counts one poll of a pending device code, by the code's SHA-256: false
   * when the device polls faster than `DEVICE_POLL_INTERVAL_S`, and is
   * answered `slow_down`. Every replica must share the count.
   */
  devicePoll?: (codeHash: string) => Promise<boolean>
  /**
   * Counts one request to a provider endpoint against its client's limits
   * (§19): the refusal's message and wait, answered as 429 with
   * `Retry-After`, or null to go on. Every request is counted with
   * `clientId` null first. A token or revocation request that gets through
   * and names a client the provider knows (HTTP Basic or the form's
   * `client_id`) is then counted again with that client's id. Every replica
   * must share the count.
   */
  rateLimit?: (endpoint: OAuthEndpoint, req: IncomingMessage, clientId: string | null) => Promise<{ message: string; retryAfterSeconds: number } | null>
  /** Replaces the network fetch of client metadata documents, for tests. */
  fetch?: typeof fetch
  log?: (message: string) => void
}

export interface OAuthServer {
  provider: Provider
  /** The node request handler for the provider's endpoints. */
  callback: ReturnType<Provider['callback']>
}

/** Two cookie-signing keys derived from the KEK, so the authorization server needs no secret of its own. */
export function oauthCookieKeys(kek: Uint8Array): string[] {
  return ['docket-cloud oauth cookies v1'].map((info) => Buffer.from(hkdfSync('sha256', kek, Buffer.alloc(0), info, 32)).toString('base64url'))
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** oidc-provider's own limit on a request body. */
const BODY_LIMIT = 56 * 1024

/**
 * The client a token or revocation request names: the HTTP Basic user, or the
 * form's `client_id`. Reading the form consumes the body, so it is left on
 * `req.body`, where oidc-provider takes an already read body from.
 */
async function requestClientId(ctx: Pick<KoaContextWithOIDC, 'get' | 'is' | 'method' | 'req' | 'throw'>): Promise<string | null> {
  const basic = /^basic\s+(\S+)$/i.exec(ctx.get('authorization'))
  if (basic?.[1]) {
    const user = Buffer.from(basic[1], 'base64').toString('utf8').split(':')[0] ?? ''
    try {
      return decodeURIComponent(user.replace(/\+/g, ' ')) || null
    } catch {
      return null
    }
  }
  if (ctx.method !== 'POST' || !ctx.is('application/x-www-form-urlencoded') || !ctx.req.readable) return null
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of ctx.req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    received += chunk.length
    if (received > BODY_LIMIT) ctx.throw(413, 'request entity too large')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  ;(ctx.req as IncomingMessage & { body?: string }).body = body
  return new URLSearchParams(body).get('client_id') || null
}

/** Whether the provider knows a client: registered, static or a metadata document it can resolve. */
async function knownClient(provider: Provider, clientId: string): Promise<boolean> {
  try {
    return Boolean(await provider.Client.find(clientId))
  } catch {
    return false
  }
}

/** Models whose removal ends someone's access: each notifies the API processes (§8.5). */
const REVOKING = new Set(['AccessToken', 'RefreshToken', 'Grant'])

/**
 * Payload fields stored sealed, by model: a device code is found by the
 * code the user types, so the code itself (`jti`) is kept, encrypted, with
 * it; an interaction names the device code it approves.
 */
const SEALED: Record<string, readonly string[]> = { DeviceCode: ['jti', 'userCode'], Interaction: ['deviceCode'] }
/** A device code is looked up by its user code's SHA-256, in the `uid` column. */
const userCodeHash = (userCode: string) => sha256(`user-code:${userCode}`)

/** The key sealed payload fields are encrypted with: derived from the cookie keys, so from the KEK. */
function storeKey(cookieKeys: readonly string[]): Buffer {
  return Buffer.from(hkdfSync('sha256', cookieKeys[0] ?? '', Buffer.alloc(0), 'docket-cloud oauth store v1', 32))
}

function seal(key: Buffer, value: Record<string, unknown>, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad))
  const text = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), text]).toString('base64url')
}

function unseal(key: Buffer, sealed: string, aad: string): Record<string, unknown> {
  const bytes = Buffer.from(sealed, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)).setAAD(Buffer.from(aad))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as Record<string, unknown>
}

/** Who and what a stored model names, for the grants list and revocation. */
function indexed(model: string, id: string, payload: AdapterPayload) {
  const resource =
    model === 'AccessToken' && typeof payload.aud === 'string'
      ? payload.aud
      : model === 'Grant' && payload.resources && typeof payload.resources === 'object'
        ? (Object.keys(payload.resources)[0] ?? null)
        : null
  return {
    // A grant is indexed by its own id, so revoking it removes it and its tokens together.
    grantId: model === 'Grant' ? id : typeof payload.grantId === 'string' ? payload.grantId : null,
    uid: model === 'DeviceCode' && typeof payload.userCode === 'string' ? userCodeHash(payload.userCode) : typeof payload.uid === 'string' ? payload.uid : null,
    accountId: typeof payload.accountId === 'string' ? payload.accountId : null,
    clientId: typeof payload.clientId === 'string' ? payload.clientId : typeof payload.client_id === 'string' ? payload.client_id : null,
    resource,
  }
}

/**
 * `oidc-provider`'s storage in `platform.oauth_store`. Ids are stored as
 * their SHA-256, and a model's `jti` (which is its id: the token or code
 * itself) is dropped from the stored payload and restored on read, so the
 * table holds no usable token, code or session. What must be read back
 * without the id - a device code, found by its user code - is sealed
 * (`SEALED`), bound to its row.
 */
class PostgresAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly platform: Platform,
    private readonly key: Buffer,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const keys = indexed(this.model, id, payload)
    const stored: AdapterPayload = { ...payload }
    delete stored.jti
    const hidden = Object.fromEntries((SEALED[this.model] ?? []).filter((field) => payload[field] !== undefined).map((field) => [field, payload[field]]))
    for (const field of SEALED[this.model] ?? []) delete stored[field]
    if (Object.keys(hidden).length) stored.sealed = seal(this.key, hidden, `${this.model}|${sha256(id)}`)
    await this.platform((tx) =>
      tx.query(
        `INSERT INTO platform.oauth_store (model, id_hash, payload, grant_id, uid, account_id, client_id, resource, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::integer IS NULL THEN NULL ELSE now() + make_interval(secs => $9::integer) END)
         ON CONFLICT (model, id_hash) DO UPDATE SET payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id, uid = EXCLUDED.uid,
           account_id = EXCLUDED.account_id, client_id = EXCLUDED.client_id, resource = EXCLUDED.resource, expires_at = EXCLUDED.expires_at`,
        [this.model, sha256(id), stored, keys.grantId, keys.uid, keys.accountId, keys.clientId, keys.resource, Number.isFinite(expiresIn) ? Math.ceil(expiresIn) : null],
      ),
    )
  }

  private async findWhere(column: 'id_hash' | 'uid', value: string, id?: string): Promise<AdapterPayload | undefined> {
    const { rows } = await this.platform((tx) =>
      tx.query<{ payload: AdapterPayload; id_hash: string; consumed_at: Date | null }>(
        `SELECT payload, id_hash, consumed_at FROM platform.oauth_store
          WHERE model = $1 AND ${column} = $2 AND (expires_at IS NULL OR expires_at > now())`,
        [this.model, value],
      ),
    )
    const row = rows[0]
    if (!row) return undefined
    const { sealed, ...payload } = row.payload
    let opened: Record<string, unknown> = {}
    try {
      if (typeof sealed === 'string') opened = unseal(this.key, sealed, `${this.model}|${row.id_hash}`)
    } catch {
      // Sealed under another key (a KEK rotated since): as good as gone.
      return undefined
    }
    return {
      ...payload,
      ...opened,
      ...(id === undefined ? {} : { jti: id }),
      ...(row.consumed_at ? { consumed: Math.floor(row.consumed_at.getTime() / 1000) } : {}),
    }
  }

  find(id: string) {
    return this.findWhere('id_hash', sha256(id), id)
  }

  findByUid(uid: string) {
    return this.findWhere('uid', uid)
  }

  findByUserCode(userCode: string) {
    return this.findWhere('uid', userCodeHash(userCode))
  }

  async consume(id: string): Promise<void> {
    await this.platform((tx) =>
      tx.query('UPDATE platform.oauth_store SET consumed_at = now() WHERE model = $1 AND id_hash = $2', [this.model, sha256(id)]),
    )
  }

  async destroy(id: string): Promise<void> {
    await this.platform(async (tx) => {
      await tx.query('DELETE FROM platform.oauth_store WHERE model = $1 AND id_hash = $2', [this.model, sha256(id)])
      if (REVOKING.has(this.model)) await notifyRevoked(tx, `oauth:${this.model}`)
    })
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.platform(async (tx) => {
      const { rowCount } = await tx.query('DELETE FROM platform.oauth_store WHERE model = $1 AND grant_id = $2', [this.model, grantId])
      if (rowCount && REVOKING.has(this.model)) await notifyRevoked(tx, `oauth:grant`)
    })
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The web app's policy (§19, `apps/server/svelte.config.js`) for the pages this server renders outside
 * SvelteKit. Inline scripts do not run, so the code field's select-on-focus handler is simply skipped;
 * the device page's auto-submitting form gets its script's hash added by oidc-provider.
 */
export const PAGE_CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src-attr 'unsafe-inline'"

/** A plain page of the authorization server's own: the error page and the device flow's steps. */
function page(ctx: KoaContextWithOIDC, heading: string, body: string) {
  ctx.type = 'html'
  ctx.set('content-security-policy', PAGE_CSP)
  ctx.body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docket Cloud</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1c1917">
<h1 style="font-size:1.25rem">${heading}</h1>
${body}</body></html>`
}

/** The page oidc-provider shows when a request cannot go on: plain, with the error and nothing else. */
function renderError(ctx: KoaContextWithOIDC, out: { error: string; error_description?: string | undefined }) {
  page(
    ctx,
    'This sign-in request cannot go on',
    `<p><code>${escape(out.error)}</code>${out.error_description ? ` - ${escape(out.error_description)}` : ''}</p>
<p>Start again from your MCP client.</p>`,
  )
}

/** Why a code was not taken, as the code entry page says it again. */
const CODE_PROBLEMS: Record<string, string> = {
  NoCodeError: 'Enter the code your terminal shows.',
  NotFoundError: 'That code is not one this server issued. Check it and try again.',
  ExpiredError: 'That code has expired. Run docket cloud login again for a new one.',
  AlreadyUsedError: 'That code was already used. Run docket cloud login again for a new one.',
  AbortedError: 'The sign-in was cancelled. Run docket cloud login again to start over.',
}

/** The device flow's pages (RFC 8628 §3.3): enter the code, confirm it, done. Approval itself is the consent screen. */
const deviceFlowPages = {
  async userCodeInputSource(ctx: KoaContextWithOIDC, form: string, _out?: unknown, err?: Error) {
    const problem = err ? (CODE_PROBLEMS[err.name] ?? 'Something went wrong with that code. Try again.') : null
    page(
      ctx,
      'Sign in to Docket Cloud',
      `<p>${problem ? `<strong>${escape(problem)}</strong>` : 'Enter the code your terminal shows.'}</p>
${form}
<p><button type="submit" form="op.deviceInputForm">Continue</button></p>`,
    )
  },
  async userCodeConfirmSource(ctx: KoaContextWithOIDC, form: string, client: { clientName?: unknown; clientId: string }, _info: unknown, userCode: string) {
    const name = typeof client.clientName === 'string' && client.clientName ? client.clientName : client.clientId
    page(
      ctx,
      `Sign in ${escape(name)}?`,
      `<p>Check that your terminal shows this code:</p>
<p style="font-size:1.75rem;font-family:ui-monospace,monospace;letter-spacing:0.1em"><strong>${escape(userCode)}</strong></p>
<p>If you did not just run <code>docket cloud login</code>, or the code differs, cancel.</p>
${form}
<p><button type="submit" form="op.deviceConfirmForm">Continue</button>
<button type="submit" form="op.deviceConfirmForm" name="abort" value="yes">Cancel</button></p>`,
    )
  },
  async successSource(ctx: KoaContextWithOIDC) {
    page(ctx, 'Signed in', '<p>Your terminal is signed in. You can close this page.</p>')
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A public client whose every redirect is plain http to a loopback address. */
function loopbackOnly(metadata: Record<string, unknown>): boolean {
  const uris = metadata.redirect_uris
  if (metadata.token_endpoint_auth_method !== 'none' || !Array.isArray(uris) || uris.length === 0) return false
  return uris.every((uri) => {
    const parsed = typeof uri === 'string' ? URL.parse(uri) : null
    return parsed?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  })
}

export function createOAuthServer(options: OAuthServerOptions): OAuthServer {
  // Access and refresh tokens are opaque, so nothing is signed with this key; the provider still wants one.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...privateKey.export({ format: 'jwk' }), use: 'sig', alg: 'ES256' }

  const key = storeKey(options.cookieKeys)
  const configuration: Configuration = {
    adapter: (model: string) => new PostgresAdapter(model, options.platform, key),
    jwks: { keys: [jwk as never] },
    // The CLI's device sign-in: public, and the only client the device grant is for.
    clients: [
      {
        client_id: CLI_CLIENT_ID,
        client_name: 'docket CLI',
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: [DEVICE_CODE_GRANT, 'refresh_token'],
        response_types: [],
        redirect_uris: [],
      },
    ],
    extraClientMetadata: {
      properties: ['grant_types', 'application_type'],
      validator: (ctx, property, value, metadata) => {
        // A registered or metadata-document client cannot take the device grant: only the server's own CLI client does.
        if (ctx && property === 'grant_types' && Array.isArray(value) && value.includes(DEVICE_CODE_GRANT)) {
          throw new errors.InvalidClientMetadata(`${DEVICE_CODE_GRANT} is for docket's own CLI only`)
        }
        // A public client that redirects only to loopback is a native app (RFC 8252 §8.4), and its redirect may take
        // any port (§7.3): Claude Code's metadata document lists http://localhost/callback without one, and names no
        // application_type, so the provider's web default would refuse the port it listens on.
        if (property === 'application_type' && value === 'web' && loopbackOnly(metadata)) metadata.application_type = 'native'
      },
    },
    cookies: {
      keys: options.cookieKeys,
      long: { signed: true, sameSite: 'lax' },
      short: { signed: true, sameSite: 'lax' },
    },
    routes: { ...OAUTH_PATHS, userinfo: '/oauth/me', end_session: '/oauth/session/end', introspection: '/oauth/introspect' },
    // Docket's scopes belong to the resource (getResourceServerInfo), not to the provider itself.
    scopes: ['openid', 'offline_access'],
    claims: { openid: ['sub'] },
    responseTypes: ['code'],
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // The one signing key is ES256; nothing asks for ID tokens, but registration checks the default.
      id_token_signed_response_alg: 'ES256',
    },
    pkce: { required: () => true },
    // What the metadata advertises. Not private_key_jwt or client_secret_jwt: the first has the server fetch a
    // client's jwks_uri, a URL anyone can register (§19 SSRF), and neither is used by MCP clients.
    clientAuthMethods: ['none', 'client_secret_basic', 'client_secret_post'],
    // Subjects are public, so a sector_identifier_uri is never needed, and validating one fetches it at registration.
    sectorIdentifierUriValidate: () => false,
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL_S,
      AuthorizationCode: 60,
      DeviceCode: DEVICE_CODE_TTL_S,
      RefreshToken: REFRESH_TOKEN_TTL_S,
      Grant: REFRESH_TOKEN_TTL_S,
      Interaction: 60 * 60,
      Session: 24 * 60 * 60,
    },
    // Tokens outlive the provider's own one-day sign-in session: a refresh token lasts 30 days (§8.2).
    expiresWithSession: async () => false,
    // Every refresh rotates the refresh token (§8.2).
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    findAccount: async (_ctx, sub) =>
      (await options.isHuman(sub)) ? { accountId: sub, claims: async () => ({ sub }) } : undefined,
    interactions: { url: (_ctx, interaction) => `/oauth/consent/${interaction.uid}` },
    // A browser client may call the token endpoint from its redirect's origin.
    clientBasedCORS: (_ctx, origin, client) =>
      origin !== 'null' && (client.redirectUris ?? []).some((uri) => URL.parse(uri)?.origin === origin),
    extraTokenClaims: async (_ctx, token) => {
      if (token.kind !== 'AccessToken' || typeof token.aud !== 'string') return undefined
      const bound = await options.resourceFor(token.aud)
      if (!bound) return undefined
      return bound.workspaceId === null ? { org_id: bound.orgId } : { org_id: bound.orgId, workspace_id: bound.workspaceId }
    },
    fetchResponseBodyLimits: { 'client_id metadata document': 64 * 1024 },
    ...(options.fetch ? { fetch: options.fetch } : {}),
    renderError,
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: true },
      deviceFlow: { enabled: true, ...deviceFlowPages },
      // Open registration, for MCP clients that still use DCR (§8.2).
      registration: { enabled: true },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch: async (_ctx, clientId) => cimdFetchAllowed(clientId),
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: async (_ctx, _client, oneOf) => oneOf,
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, resourceIndicator) => {
          if (!(await options.resourceFor(resourceIndicator))) {
            throw new errors.InvalidTarget('resource is not an account or workspace MCP endpoint on this server')
          }
          return {
            scope: SCOPES.join(' '),
            audience: resourceIndicator,
            accessTokenTTL: ACCESS_TOKEN_TTL_S,
            accessTokenFormat: 'opaque',
          }
        },
      },
    },
  }

  const provider = new Provider(options.issuer, configuration)
  // Traefik terminates TLS (§3); the server in front rewrites Host and X-Forwarded-Proto from the configured origin.
  provider.proxy = true
  provider.on('server_error', (_ctx, error) => options.log?.(`oauth: ${error.message}`))
  // The device pages carry the CSP from the start, so the form oidc-provider posts back to itself is covered too.
  provider.use(async (ctx, next) => {
    if (providerEndpoint(ctx.path) === 'code_verification') ctx.set('content-security-policy', PAGE_CSP)
    await next()
  })
  // Rate limits before anything else runs: an endpoint's work, a registration's write, a client's metadata fetch.
  const rateLimit = options.rateLimit
  if (rateLimit) {
    provider.use(async (ctx, next) => {
      const endpoint = providerEndpoint(ctx.path)
      if (!endpoint) return next()
      let refused = await rateLimit(endpoint, ctx.req, null)
      if (!refused && (endpoint === 'token' || endpoint === 'revocation')) {
        const clientId = await requestClientId(ctx)
        if (clientId && (await knownClient(provider, clientId))) refused = await rateLimit(endpoint, ctx.req, clientId)
      }
      if (!refused) return next()
      ctx.status = 429
      ctx.set('retry-after', String(refused.retryAfterSeconds))
      ctx.set('cache-control', 'no-store')
      // The browser's pages get text; the endpoints clients call get an OAuth error body.
      ctx.body = endpoint === 'authorization' || endpoint === 'code_verification' ? refused.message : { error: 'rate_limited', error_description: refused.message }
    })
  }
  // RFC 8628 §3.2 and §3.5: the device response says how often to poll, and a device that polls faster is told to slow down.
  provider.use(async (ctx, next) => {
    await next()
    const route = ctx.oidc?.route
    if (route === 'device_authorization' && ctx.status === 200 && isRecord(ctx.body)) {
      ctx.body = { ...ctx.body, interval: DEVICE_POLL_INTERVAL_S }
    } else if (route === 'token' && options.devicePoll && isRecord(ctx.body) && ctx.body.error === 'authorization_pending') {
      const code = ctx.oidc?.params?.device_code
      if (typeof code === 'string' && !(await options.devicePoll(sha256(code)))) {
        ctx.body = { error: 'slow_down', error_description: `Poll at most every ${DEVICE_POLL_INTERVAL_S} seconds.` }
      }
    }
  })
  return { provider, callback: provider.callback() }
}
