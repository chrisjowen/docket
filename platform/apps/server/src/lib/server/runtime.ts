// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'

import { env } from '$env/dynamic/private'
import { aiCaps, auditCapWarning, configureModels, type AiCaps } from '@docket/platform-ai'
import { audit } from '@docket/platform-audit'
import { githubApp, githubAppConfigFromEnv, readOptionalFile, type GitHubApp } from '@docket/platform-github'
import {
  createOAuthServer,
  isProviderPath,
  listenForRevocations,
  oauthCookieKeys,
  parseMcpResourceUrl,
  syncPasswordUsers,
  tokenResolver,
  type GitHubOAuthConfig,
  type OAuthServer,
  type OidcProviderConfig,
  type TokenResolver,
} from '@docket/platform-auth'
import { keyring, workspaceBySlug, type Keyring } from '@docket/platform-canonical-store'
import { platformKeyService, readKekFile, type Kek, type KeyService } from '@docket/platform-keys'
import {
  RATE_LIMITS,
  callsPerMinute,
  devicePollLimits,
  oauthLimits,
  perMinute,
  rateLimitMessage,
  postgresBucketStore,
  rateLimiter as bucketLimiter,
  type BucketRule,
  type RateLimiter as BucketLimiter,
} from '@docket/platform-limits'
import { postgresProvisioner, rewrapOrgKeys, type TenantProvisioner } from '@docket/platform-provisioner'
import { queryClient, queryKey, type QueryClient } from '@docket/platform-mcp-tools'
import {
  LIMITS,
  allowlist,
  countLiveOrgs,
  migrateBehindOrgs,
  migratePlatform,
  replaceSigninAllowlist,
  tenantRouter,
  userById,
  type TenantRouter,
} from '@docket/platform-tenancy'
import pg from 'pg'

import { loginList } from './admin'
import type { ReadinessProbes } from './health'
import { startJobs } from './jobs'
import { bindMetrics, countRefusal, startMetricsServer } from './metrics'
import { demoLogin, frameAncestors, type DemoLogin } from './preview'
import { oidcProviders, passwordUsers, signinAllowList } from './providers'
import { rateLimiter, type RateLimiter } from './rate-limit'

const DEFAULT_KEK_FILE = '/etc/docket/kek/kek'
const DEFAULT_KEK_ID = 'platform-v1'
const PING_TIMEOUT_MS = 2_000

/** Everything a request needs, made once at server start. */
export interface Runtime {
  router: TenantRouter
  provisioner: TenantProvisioner
  /** Each org's data keys, unwrapped through the KEK and cached for at most 10 minutes. */
  keyring: Keyring
  /** Each org's monthly AI budget and spend (§11). */
  caps: AiCaps
  /** Null until the GitHub OAuth app's id and secret are configured. */
  github: GitHubOAuthConfig | null
  /** The OpenID Connect providers people may sign in with, by name (`DOCKET_OIDC_PROVIDERS`). */
  oidc: ReadonlyMap<string, OidcProviderConfig>
  /** Whether the operator lists password users (`DOCKET_PASSWORD_USERS`): then the sign-in page asks for a login and password. */
  password: boolean
  /** The GitHub App repo sync runs as (§14.1); null until its id, slug and private key are configured. */
  githubApp: GitHubApp | null
  /** The secret GitHub signs webhook deliveries with; null until configured, and then every delivery is refused. */
  webhookSecret: string | null
  /** The public origin, for example https://docket.example.com. */
  origin: string
  /** False only when serving plain HTTP locally. */
  secureCookies: boolean
  /** The CSP's frame-ancestors: `'none'`, or loopback origins for a local preview in a tool's frame. */
  frameAncestors: string
  /** A throwaway sign-in for a local preview; null in every deployment. */
  demo: DemoLogin | null
  /** Bearer tokens to principals, with the in-process cache revocation notices clear (§8.5). */
  tokens: TokenResolver
  /** The OAuth authorization server MCP clients sign in through (§8.2). */
  oauth: OAuthServer
  /** The keys the authorization server signs its cookies with: the consent page checks its interaction cookie. */
  oauthCookieKeys: string[]
  /** The worker's query service, which reaches each org's projections (docket_search, docket_ask). */
  query: QueryClient
  /** How many orgs the beta holds: 8 (§12), unless `DOCKET_BETA_ORG_LIMIT` says otherwise (the e2e suite's server). */
  maxOrgs: number
  /** Refused MCP credentials per client address a minute: 30, unless `DOCKET_MCP_REFUSED_PER_MINUTE` says otherwise. */
  refusedAuth: RateLimiter
  /** The rate limits (§12): token buckets in Postgres, shared by every replica. */
  limiter: BucketLimiter
  /** Sign-in requests per client address; `DOCKET_SIGNIN_PER_MINUTE` overrides it for local test runs. */
  signInRule: BucketRule
  /** The logins and emails (lowercase) of the people who run the platform: they review the beta waitlist (`DOCKET_PLATFORM_ADMINS`). */
  platformAdmins: ReadonlySet<string>
  /** Whether a cognee service runs beside the worker (`DOCKET_COGNEE_ENABLED`): only then can a workspace turn cognee on. */
  cognee: boolean
}

/**
 * Where `server.js` finds the authorization server: its endpoints answer
 * before SvelteKit sees the request, because SvelteKit refuses form posts
 * without a same-origin `Origin` header, and an MCP client's token request
 * carries none.
 */
const OAUTH_HANDLER = Symbol.for('docket-cloud.oauth')

let kek: Uint8Array | undefined
/** The other KEK during a rotation, incoming or outgoing (ops/runbooks/rotate-kek.md). */
let otherKek: Kek | undefined
let pool: pg.Pool | undefined
let runtime: Runtime | undefined
let startupError: string | undefined

/**
 * A Postgres pool. TLS is always on and verifies the server's name against
 * the CNPG cluster CA (the equivalent of `sslmode=verify-full`).
 * `PGSSLMODE=disable` exists for a local preview against a container and is
 * refused in production.
 */
function connection(host: string, user: string | undefined, password: string | undefined): pg.ClientConfig {
  const caFile = env.PGSSLROOTCERT
  const plaintext = env.PGSSLMODE === 'disable'
  if (plaintext && env.NODE_ENV === 'production') {
    throw new Error('PGSSLMODE=disable is refused in production')
  }
  return {
    host,
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE,
    user,
    password,
    ssl: plaintext
      ? false
      : caFile
        ? { ca: readFileSync(caFile, 'utf8'), servername: host, rejectUnauthorized: true }
        : { rejectUnauthorized: true },
    connectionTimeoutMillis: PING_TIMEOUT_MS,
    // Only the readiness ping uses a query timeout; migrations and provisioning take their time.
  }
}

function createPool(host: string, user: string | undefined, password: string | undefined, max: number): pg.Pool {
  const created = new pg.Pool({ ...connection(host, user, password), max })
  created.on('error', (error) => console.error(`postgres pool: ${error.message}`))
  return created
}

function githubConfig(origin: string): GitHubOAuthConfig | null {
  const clientId = env.GITHUB_CLIENT_ID
  const clientSecret = env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: new URL('/auth/github/callback', origin).toString(),
    ...(env.GITHUB_OAUTH_URL ? { oauthBase: env.GITHUB_OAUTH_URL } : {}),
    ...(env.GITHUB_API_URL ? { apiBase: env.GITHUB_API_URL } : {}),
  }
}

/**
 * The client address of a request the OAuth server answers, found as
 * adapter-node's `getClientAddress` finds it for every other route
 * (`ADDRESS_HEADER`, `XFF_DEPTH`); null when it cannot be told.
 */
function nodeClientAddress(req: IncomingMessage): string | null {
  const header = env.ADDRESS_HEADER?.toLowerCase()
  if (!header) return req.socket.remoteAddress ?? null
  const raw = req.headers[header]
  const value = (Array.isArray(raw) ? raw.join(',') : raw)?.trim()
  if (!value) return null
  if (header !== 'x-forwarded-for') return value
  const addresses = value.split(',')
  const depth = Number(env.XFF_DEPTH ?? 1)
  if (!Number.isInteger(depth) || depth < 1 || depth > addresses.length) return null
  return addresses[addresses.length - depth]?.trim() || null
}

function positiveLimit(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`${name} must be a positive whole number, not ${raw}`)
  return limit
}

/** The webhook secret, from a mounted Secret file or the environment. */
function webhookSecret(): string | null {
  const secret = env.GITHUB_WEBHOOK_SECRET_FILE ? readOptionalFile(env.GITHUB_WEBHOOK_SECRET_FILE) : env.GITHUB_WEBHOOK_SECRET
  return secret?.trim() || null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Loads the KEK, opens the pools, migrates the platform schema and every org
 * behind this build, and seeds the beta allowlist. A missing KEK or an
 * unreachable Postgres keeps the process alive but unready.
 */
export async function initRuntime(): Promise<void> {
  const kekFile = env.DOCKET_KEK_FILE ?? DEFAULT_KEK_FILE
  try {
    kek = await readKekFile(kekFile)
  } catch (error) {
    console.error(`KEK not loaded from ${kekFile}: ${errorText(error)}`)
  }
  if (env.DOCKET_KEK_OTHER_FILE && env.DOCKET_KEK_OTHER_ID) {
    try {
      otherKek = { kek: await readKekFile(env.DOCKET_KEK_OTHER_FILE), kekId: env.DOCKET_KEK_OTHER_ID }
    } catch (error) {
      console.error(`other KEK not loaded from ${env.DOCKET_KEK_OTHER_FILE}: ${errorText(error)}`)
    }
  }
  if (env.METRICS_PORT) startMetricsServer(Number(env.METRICS_PORT))
  bindMetrics({ router: null, ready: () => false })
  if (!env.PGHOST) return

  pool = createPool(env.PGHOST, env.PGUSER, env.PGPASSWORD, 10)
  if (kek) await boot(kek, pool)
}

/** Migrates and wires the runtime; on failure (Postgres not up yet), tries again with backoff. */
async function boot(key: Uint8Array, requests: pg.Pool, attempt = 1): Promise<void> {
  let admin: pg.Pool | undefined
  try {
    const keys: KeyService = await platformKeyService({
      kek: key,
      kekId: env.DOCKET_KEK_ID ?? DEFAULT_KEK_ID,
      ...(otherKek ? { others: [otherKek] } : {}),
    })
    const appRole = env.DOCKET_PG_APP_ROLE ?? env.PGUSER ?? 'docket_app'
    admin = createPool(env.PGHOST ?? '', env.DOCKET_PG_ADMIN_USER, env.DOCKET_PG_ADMIN_PASSWORD, 3)
    const applied = await migratePlatform(admin, { appRole })
    if (applied) console.log(`migrations: applied ${applied} platform migration(s)`)
    const migrated = await migrateBehindOrgs(admin, { appRole })
    if (migrated.length) console.log(`migrations: brought ${migrated.length} org schema(s) up to date`)
    if (keys.otherKekIds.length) {
      // A KEK rotation: move every data key under the current KEK before serving.
      const moved = await rewrapOrgKeys(admin, keys)
      console.log(`keys: rewrapped ${moved.rewrapped} data key(s) under ${keys.kekId}; left under other KEKs: ${JSON.stringify(moved.remaining)}`)
    }

    const router = tenantRouter(requests)
    if (env.DOCKET_BUNDLED_GRAPH === 'true' && await router.withPlatform(countLiveOrgs) > 1) {
      throw new Error('the database has multiple accounts; a bundled Neo4j can serve only one. Configure a managed graph.')
    }
    const seed = (env.DOCKET_BETA_ALLOWLIST ?? '')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean)
    if (seed.length) await router.withPlatform((tx) => allowlist(tx, seed, 'seeded from DOCKET_BETA_ALLOWLIST'))

    const origin = env.ORIGIN ?? 'http://127.0.0.1:3000'
    const local = { origin, production: env.NODE_ENV === 'production' }

    // Sign-in beside GitHub: the config is the source of the allowlist and the password users, so each start replaces them.
    // The models orgs may choose from: the operator's, when their provider is not OpenRouter.
    configureModels(env.DOCKET_AI_MODELS)
    const oidc = oidcProviders(env.DOCKET_OIDC_PROVIDERS, local)
    const allowed = signinAllowList(env.DOCKET_SIGNIN_ALLOW)
    await router.withPlatform((tx) => replaceSigninAllowlist(tx, allowed))
    const listed = passwordUsers(env.DOCKET_PASSWORD_USERS)
    const synced = await router.withPlatform((tx) => syncPasswordUsers(tx, listed))
    for (const [what, logins] of Object.entries(synced)) if (logins.length) console.log(`password sign-in: ${what} ${logins.join(', ')}`)
    const platform = <T>(fn: (tx: pg.ClientBase) => Promise<T>) => router.withPlatform(fn)

    const tokens = tokenResolver({ platform })
    // One connection per process listens for revocations and empties the lookup cache on each (§8.5).
    listenForRevocations({
      connect: () => new pg.Client(connection(env.PGHOST ?? '', env.PGUSER, env.PGPASSWORD)),
      onRevoked: () => tokens.forget(),
      log: (message) => console.error(message),
    })
    const cookieKeys = oauthCookieKeys(key)
    const limiter = bucketLimiter({ store: postgresBucketStore(requests), onRefused: countRefusal })
    const oauthRules = {
      token: perMinute(positiveLimit('DOCKET_OAUTH_TOKEN_PER_MINUTE', env.DOCKET_OAUTH_TOKEN_PER_MINUTE, callsPerMinute(RATE_LIMITS.oauthTokenPerClient))),
      tokenAddress: perMinute(positiveLimit('DOCKET_OAUTH_TOKEN_ADDRESS_PER_MINUTE', env.DOCKET_OAUTH_TOKEN_ADDRESS_PER_MINUTE, callsPerMinute(RATE_LIMITS.oauthTokenPerAddress))),
      other: perMinute(positiveLimit('DOCKET_OAUTH_PER_MINUTE', env.DOCKET_OAUTH_PER_MINUTE, callsPerMinute(RATE_LIMITS.oauthPerAddress))),
      registration: perMinute(positiveLimit('DOCKET_OAUTH_REGISTER_PER_MINUTE', env.DOCKET_OAUTH_REGISTER_PER_MINUTE, callsPerMinute(RATE_LIMITS.registrationsPerAddress))),
    }
    const oauth = createOAuthServer({
      issuer: origin,
      platform,
      cookieKeys,
      isHuman: async (userId) => (await platform((tx) => userById(tx, userId)))?.kind === 'human',
      resourceFor: async (url) => {
        // A docket's MCP URL, or an account's (tenancy v2 §4): one address for every docket, with a docket argument.
        const named = parseMcpResourceUrl(origin, url, { account: true })
        if (!named) return null
        const org = await platform(async (tx) => {
          const { rows } = await tx.query<{ id: string }>("SELECT id FROM platform.orgs WHERE slug = $1 AND status = 'active'", [named.orgSlug])
          return rows[0] ?? null
        })
        if (!org) return null
        if (named.workspaceSlug === null) return { orgId: org.id, workspaceId: null }
        const workspaceSlug = named.workspaceSlug
        const workspace = await router.withTenant(org.id, (tx) => workspaceBySlug(tx, workspaceSlug))
        return workspace ? { orgId: org.id, workspaceId: workspace.id } : null
      },
      devicePoll: async (codeHash) => (await limiter.check(devicePollLimits(codeHash))).allowed,
      rateLimit: async (endpoint, req, clientId) => {
        const address = nodeClientAddress(req)
        if (!address) return null
        const decision = await limiter.check(oauthLimits(endpoint, address, clientId, oauthRules))
        if (decision.allowed) return null
        // As for sign-in: the first refusal in a window is audited, repeats answered from memory are not.
        if (!decision.cached) {
          const userAgent = req.headers['user-agent'] ?? null
          await router.withPlatform((tx) =>
            audit(tx, { orgId: null, actor: 'anonymous', ip: address, userAgent, action: `oauth.${endpoint}`, outcome: 'denied', target: ['rate-limit'], latencyMs: 0, requestId: randomUUID() }),
          )
        }
        return { message: rateLimitMessage(decision), retryAfterSeconds: decision.retryAfterSeconds }
      },
      log: (message) => console.error(message),
    })
    ;(globalThis as Record<symbol, unknown>)[OAUTH_HANDLER] = { handles: isProviderPath, callback: oauth.callback }
    if (!env.DOCKET_QUERY_URL) console.warn('DOCKET_QUERY_URL is not set: docket_search and docket_ask answer that the index is not running')

    const appConfig = githubAppConfigFromEnv(env)
    runtime = {
      router,
      provisioner: postgresProvisioner({ admin, keys, appRole }),
      keyring: keyring({ keys, platform: (fn) => router.withPlatform(fn) }),
      caps: aiCaps({ platform: (fn) => router.withPlatform(fn), notifyOwners: auditCapWarning(router) }),
      github: githubConfig(origin),
      oidc,
      password: listed.length > 0,
      githubApp: appConfig ? githubApp(appConfig) : null,
      webhookSecret: webhookSecret(),
      origin,
      secureCookies: new URL(origin).protocol === 'https:',
      frameAncestors: frameAncestors(env.DOCKET_FRAME_ANCESTORS, local),
      demo: demoLogin(env.DOCKET_DEMO_LOGIN, local),
      tokens,
      oauth,
      oauthCookieKeys: cookieKeys,
      query: queryClient({ url: env.DOCKET_QUERY_URL ?? null, key: queryKey(key) }),
      maxOrgs: positiveLimit('DOCKET_BETA_ORG_LIMIT', env.DOCKET_BETA_ORG_LIMIT, LIMITS.orgs),
      refusedAuth: rateLimiter({
        limit: positiveLimit('DOCKET_MCP_REFUSED_PER_MINUTE', env.DOCKET_MCP_REFUSED_PER_MINUTE, LIMITS.refusedMcpAuthPerMinute),
        windowMs: 60_000,
      }),
      limiter,
      signInRule: env.DOCKET_SIGNIN_PER_MINUTE ? perMinute(Number(env.DOCKET_SIGNIN_PER_MINUTE)) : RATE_LIMITS.signInPerAddress,
      platformAdmins: new Set(loginList('DOCKET_PLATFORM_ADMINS', env.DOCKET_PLATFORM_ADMINS)),
      cognee: env.DOCKET_COGNEE_ENABLED === 'true',
    }
    if (runtime.demo) console.warn(`local preview: demo sign-in as ${runtime.demo.login} is on (DOCKET_DEMO_LOGIN)`)
    startupError = undefined
    bindMetrics({ router, ready: () => kek !== undefined && runtime !== undefined })
    startJobs(requests, router)
    if (!runtime.github && !oidc.size && !runtime.password && !runtime.demo) {
      console.warn('No sign-in is configured: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, DOCKET_OIDC_PROVIDERS, or DOCKET_PASSWORD_USERS')
    }
    if (!runtime.githubApp || !runtime.webhookSecret) {
      console.warn('Repo sync is not configured: set GITHUB_APP_ID, GITHUB_APP_SLUG, the app private key and the webhook secret')
    }
  } catch (error) {
    startupError = errorText(error)
    void admin?.end()
    const delay = Math.min(30_000, 1_000 * 2 ** attempt)
    console.error(`startup (attempt ${attempt}): ${startupError}; retrying in ${delay / 1000}s`)
    setTimeout(() => void boot(key, requests, attempt + 1), delay).unref()
  }
}

/** The runtime, or a thrown 503 while the server is not ready. */
export function getRuntime(): Runtime {
  if (!runtime) throw new RuntimeUnavailable(startupError ?? 'starting')
  return runtime
}

export class RuntimeUnavailable extends Error {
  override name = 'RuntimeUnavailable'
}

export const probes: ReadinessProbes = {
  kekLoaded: () => kek !== undefined,
  async pingPostgres() {
    if (!pool) throw new Error('PGHOST is not set')
    if (startupError) throw new Error(`startup failed: ${startupError}`)
    await pool.query({ text: 'select 1', query_timeout: PING_TIMEOUT_MS } as pg.QueryConfig)
  },
}
