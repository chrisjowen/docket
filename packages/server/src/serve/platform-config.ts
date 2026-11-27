import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { parse } from 'yaml'

import { CONFIG_FILE, DEFAULT_HOST, DEFAULT_PORT, SERVER_CONFIG_VERSION, ServeConfigError, serverMode, type ServerMode } from './config.js'

/*
 * `docket-server.yaml` for the multi-tenant server: `version: 1` and
 * `mode: multi-tenant`. Accounts, their dockets and members live in the
 * server's own Postgres; the file says where that Postgres is, which other
 * stores and services the server may use and how it provisions them, which
 * model providers it calls, and how people sign in. `docket serve` and
 * `docket open --config` read it, and the platform runtime
 * (`@docket/server-platform`) runs it. A file without `mode` keeps today's
 * single-tenant `docket serve` (config.ts).
 */

/** A secret, never written into the file: a mounted file's contents, or a named environment variable. */
export type SecretRef = { file: string } | { env: string }

/**
 * Who runs a source. `external`: an operator-run service the server only
 * connects to. `bundled`: an instance the installer (Compose, Helm) runs
 * beside the server; to the server it is an endpoint like an external one.
 * `managed`: resources the server creates itself, per account.
 */
export type Provisioning = 'external' | 'bundled' | 'managed'

export interface PostgresSource {
  type: 'postgres'
  provisioning: 'external' | 'bundled'
  /** The request role's URL: what the API and worker run every query as. */
  url: SecretRef
  /** The migration and provisioning role's URL, on the same database: it owns the schemas and makes each account's role. */
  migrationUrl: SecretRef
  /** The CA the server's certificate is checked against; null: the system's. */
  tlsCa: string | null
  /** False for a plain-TCP local database (refused in production). */
  tls: boolean
  /** The platform key every account's data keys are wrapped with: a file of 32 random bytes, base64. */
  encryptionKey: { file: string; id: string; create: boolean }
}

export interface Neo4jSource {
  type: 'neo4j'
  provisioning: Provisioning
  /** `per-account`: a Neo4j of each account's own (managed); `shared`: one server for every account (local and evaluation installs only). */
  isolation: 'shared' | 'per-account'
  url: string | null
  password: SecretRef | null
  kubernetes: { namespace: string; image: string | null; storageClass: string | null; storageSize: string | null; issuer: string | null; labelDomain: string | null } | null
}

export interface QdrantSource {
  type: 'qdrant'
  provisioning: 'external' | 'bundled'
  url: string
  apiKey: SecretRef
}

export interface EmbedderSource {
  type: 'embedder'
  provisioning: 'external' | 'bundled'
  provider: 'ollama'
  url: string
  model: string
  dimensions: number
}

export interface RerankerSource {
  type: 'reranker'
  provisioning: 'external' | 'bundled'
  url: string
}

export interface CogneeSource {
  type: 'cognee'
  provisioning: 'external' | 'bundled'
  url: string
  apiKey: SecretRef
  gatewayKey: SecretRef
}

export type Source = PostgresSource | Neo4jSource | QdrantSource | EmbedderSource | RerankerSource | CogneeSource
export type SourceType = Source['type']

/** A model provider the server calls for Ask, enrichment, consolidation and drafting. */
export interface AiProvider {
  kind: 'openrouter'
  /** The platform key every account shares, metered against each account's cap. */
  apiKey: SecretRef | null
  /** A provisioning key: each account gets a key of its own with a credit limit equal to its cap. */
  provisioningKey: SecretRef | null
}

export interface PlatformConfig {
  /** The config file read. */
  file: string
  version: typeof SERVER_CONFIG_VERSION
  mode: 'multi-tenant'
  listen: { host: string; port: number }
  /** The origin people and clients reach the server at: OAuth's issuer and every callback. `http://<host>:<port>` when unset. */
  publicUrl: string | null
  /** `production` refuses plaintext Postgres, a shared Neo4j and the local sign-in. Default: production for `docket serve`, development for `docket open`. */
  environment: 'production' | 'development'
  /** Serve the product's pages; false runs the API, MCP, OAuth and sign-in alone (`--no-ui`). */
  ui: boolean
  /** `inline`: the worker runs in the server's process; `off`: elsewhere (`docket serve worker`), or not at all. */
  worker: { mode: 'inline' | 'off' }
  sources: Record<string, Source>
  /** The sources each role uses, from `defaults.stores`. */
  stores: {
    records: PostgresSource
    graph: Neo4jSource | null
    search: QdrantSource | null
    embedder: EmbedderSource | null
    reranker: RerankerSource | null
    cognee: CogneeSource | null
  }
  ai: { providers: Record<string, AiProvider>; primary: AiProvider | null }
  auth: {
    /** GitHub sign-in (an OAuth App of the operator's own). */
    github: { clientId: string; clientSecret: SecretRef; oauthUrl: string | null; apiUrl: string | null } | null
    /** One-click sign-in as one login, without a provider: loopback and development only. */
    local: { login: string } | null
    /** Who may sign in (GitHub logins; members and invitees always may), and who administers the platform. */
    access: { allow: string[]; admins: string[] }
  }
  integrations: {
    /** The GitHub App repository sync and export PRs run as. */
    githubApp: { id: string; slug: string; privateKey: SecretRef; webhookSecret: SecretRef; apiUrl: string | null } | null
  }
  limits: { accounts: number | null }
  /** A reverse proxy in front: the header the client address is read from, and how many hops of X-Forwarded-For to trust. */
  proxy: { addressHeader: string | null; xffDepth: number | null }
}

const SOURCE_TYPES: readonly SourceType[] = ['postgres', 'neo4j', 'qdrant', 'embedder', 'reranker', 'cognee']
const STORE_ROLES = { records: 'postgres', graph: 'neo4j', search: 'qdrant', embedder: 'embedder', reranker: 'reranker', cognee: 'cognee' } as const
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/
const NAME = /^[a-z][a-zA-Z0-9_-]{0,39}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface LoadServerConfigOptions {
  /** The config file; `DOCKET_SERVE_CONFIG`, else `docket-server.yaml` in `cwd` if there is one. */
  file?: string | undefined
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  /** Overrides from the command line. */
  host?: string | undefined
  port?: number | undefined
  ui?: boolean | undefined
  worker?: 'inline' | 'off' | undefined
  /** The command running it, which sets the environment the file leaves out: production for serve (the default), development for open. */
  command?: 'serve' | 'open' | undefined
}

/** The config file the options and environment name, if there is one, and its parsed contents. */
export async function readServerConfigFile(options: LoadServerConfigOptions = {}): Promise<{ file: string | null; raw: Record<string, unknown>; mode: ServerMode }> {
  const env = blankless(options.env ?? process.env)
  const cwd = resolve(options.cwd ?? process.cwd())
  const named = options.file ?? env.DOCKET_SERVE_CONFIG
  const file = named ? resolve(cwd, named) : existsSync(join(cwd, CONFIG_FILE)) ? join(cwd, CONFIG_FILE) : null
  if (!file) return { file: null, raw: {}, mode: 'single' }
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (cause) {
    throw new ServeConfigError(`${file} cannot be read: ${(cause as Error).message}`)
  }
  const parsed: unknown = parse(text) ?? {}
  if (!isObject(parsed)) throw new ServeConfigError(`${file} is not a mapping.`)
  return { file, raw: parsed, mode: serverMode(parsed, file) }
}

/** A variable set to nothing is unset: Compose and Helm pass an option left out that way. */
function blankless(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
}

/**
 * Reads and checks a multi-tenant `docket-server.yaml`: every source,
 * reference and secret it names, before anything starts. The environment's
 * documented deployment keys (`DOCKET_SERVE_HOST`, `DOCKET_SERVE_PORT`,
 * `DOCKET_PUBLIC_URL`, `DOCKET_SERVE_UI`) override the file, and the
 * command line overrides both. Paths resolve from the file's directory.
 */
export async function loadPlatformConfig(options: LoadServerConfigOptions = {}): Promise<PlatformConfig> {
  const { file, raw, mode } = await readServerConfigFile(options)
  if (!file) throw new ServeConfigError('A multi-tenant server needs its docket-server.yaml: pass --config <file>.')
  if (mode !== 'multi-tenant') throw new ServeConfigError(`${file} is a single-tenant docket serve config (no mode: multi-tenant).`)
  return platformConfigOf(raw, { ...options, file })
}

/** The checked config of a parsed file (`loadPlatformConfig` without the read). */
export function platformConfigOf(raw: Record<string, unknown>, options: LoadServerConfigOptions & { file: string }): PlatformConfig {
  const env = blankless(options.env ?? process.env)
  const { file } = options
  const base = dirname(file)
  const where = (key: string) => `${file}: ${key}`
  const fail = (key: string, message: string): never => {
    throw new ServeConfigError(`${where(key)} ${message}`)
  }
  const from = (path: string) => (isAbsolute(path) ? path : resolve(base, path))
  const known = (value: Record<string, unknown>, key: string, keys: readonly string[]) => {
    for (const name of Object.keys(value)) if (!keys.includes(name)) fail(key ? `${key}.${name}` : name, `is not a setting this docket reads (${keys.join(', ')}).`)
  }
  known(raw, '', ['version', 'mode', 'listen', 'publicUrl', 'environment', 'ui', 'worker', 'sources', 'defaults', 'ai', 'auth', 'integrations', 'limits', 'proxy'])

  const string = (value: unknown, key: string): string => (typeof value === 'string' && value.trim() ? value.trim() : fail(key, 'is a string.'))
  const optionalString = (value: unknown, key: string): string | null => (value === undefined || value === null ? null : string(value, key))
  const url = (value: unknown, key: string, protocols: readonly string[] = ['http:', 'https:']): string => {
    const text = string(value, key)
    try {
      const parsed = new URL(text)
      if (protocols.includes(parsed.protocol)) return text.replace(/\/+$/, '')
    } catch {
      // Reported below.
    }
    return fail(key, `is a URL (${protocols.join(', ')}).`)
  }
  const secret = (value: unknown, key: string, { fileOnly = false } = {}): SecretRef => {
    if (typeof value === 'string') fail(key, `is a secret: { file: <path> }${fileOnly ? '' : ' or { env: <VARIABLE> }'}, never the value itself.`)
    if (!isObject(value)) fail(key, `is { file: <path> }${fileOnly ? '' : ' or { env: <VARIABLE> }'}.`)
    const ref = value as Record<string, unknown>
    if (typeof ref.file === 'string' && ref.env === undefined) {
      const path = from(ref.file)
      if (!existsSync(path)) fail(`${key}.file`, `names ${path}, which does not exist.`)
      return { file: path }
    }
    if (!fileOnly && typeof ref.env === 'string' && ref.file === undefined) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(ref.env)) fail(`${key}.env`, 'is an environment variable name, like DOCKET_PG_URL.')
      if (env[ref.env] === undefined) fail(`${key}.env`, `names ${ref.env}, which is not set.`)
      return { env: ref.env }
    }
    return fail(key, fileOnly ? 'is { file: <path> }: this secret is read from a file only.' : 'is { file: <path> } or { env: <VARIABLE> }, one of them.')
  }
  const provisioning = <T extends Provisioning>(value: unknown, key: string, allowed: readonly T[]): T => {
    const chosen = value ?? 'external'
    if (!allowed.includes(chosen as T)) fail(key, `is ${allowed.join(' or ')} for this source${chosen === 'managed' ? ': the server does not create this kind of source itself' : chosen === 'bundled' || chosen === 'external' ? '' : `, not ${String(chosen)}`}.`)
    return chosen as T
  }
  const logins = (value: unknown, key: string): string[] => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) return fail(key, 'is a list of GitHub logins.')
    return [
      ...new Set(
        value.map((login, index) => {
          const text = typeof login === 'string' ? login.trim().replace(/^@/, '').toLowerCase() : ''
          return LOGIN.test(text) ? text : fail(`${key}[${index}]`, 'is a GitHub login, like alice.')
        })
      )
    ]
  }
  const positive = (value: unknown, key: string): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fail(key, 'is a whole number above 0.'))

  // Where it listens and who reaches it.
  const listenRaw = raw.listen === undefined ? {} : isObject(raw.listen) ? raw.listen : fail('listen', 'is { host, port }.')
  known(listenRaw, 'listen', ['host', 'port'])
  const host = options.host ?? env.DOCKET_SERVE_HOST ?? (listenRaw.host === undefined ? DEFAULT_HOST : string(listenRaw.host, 'listen.host'))
  const portValue = options.port ?? (env.DOCKET_SERVE_PORT !== undefined ? Number(env.DOCKET_SERVE_PORT) : (listenRaw.port ?? DEFAULT_PORT))
  const port = typeof portValue === 'number' && Number.isInteger(portValue) && portValue >= 0 && portValue <= 65_535 ? portValue : fail('listen.port', 'is a port number.')
  const publicUrl = env.DOCKET_PUBLIC_URL !== undefined ? url(env.DOCKET_PUBLIC_URL, 'DOCKET_PUBLIC_URL') : raw.publicUrl === undefined ? null : url(raw.publicUrl, 'publicUrl')
  const environment = raw.environment === undefined ? (options.command === 'open' ? 'development' : 'production') : raw.environment === 'production' || raw.environment === 'development' ? raw.environment : fail('environment', 'is production or development.')
  const inProduction = `in production (${raw.environment === undefined ? `docket ${options.command ?? 'serve'} runs production unless the file says environment: development` : 'environment: production'})`
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  if (!loopback && publicUrl === null) fail('publicUrl', `is needed when the server listens beyond this machine (listen.host ${host}): the https:// origin people reach it at, through the TLS proxy in front.`)

  const uiRaw = isObject(raw.ui) ? raw.ui.enabled : raw.ui
  if (isObject(raw.ui)) known(raw.ui, 'ui', ['enabled'])
  const ui = options.ui ?? (env.DOCKET_SERVE_UI !== undefined ? env.DOCKET_SERVE_UI !== 'false' && env.DOCKET_SERVE_UI !== '0' : uiRaw === undefined ? true : typeof uiRaw === 'boolean' ? uiRaw : fail('ui', 'is true or false, or { enabled }.'))

  const workerRaw = raw.worker === undefined ? {} : isObject(raw.worker) ? raw.worker : fail('worker', 'is { mode: inline | off }.')
  known(workerRaw, 'worker', ['mode'])
  const workerMode = options.worker ?? (workerRaw.mode === undefined ? 'inline' : workerRaw.mode === 'inline' || workerRaw.mode === 'off' ? workerRaw.mode : fail('worker.mode', 'is inline (the worker runs in this process) or off.'))

  // Sources, by name.
  const sourcesRaw = isObject(raw.sources) ? raw.sources : fail('sources', 'is a map of named sources: { <name>: { type: postgres | neo4j | qdrant | embedder | reranker | cognee, ... } }.')
  const sources: Record<string, Source> = {}
  for (const [name, value] of Object.entries(sourcesRaw)) {
    const key = `sources.${name}`
    if (!NAME.test(name)) fail(key, 'is named with a letter, then letters, digits, "_" or "-".')
    if (!isObject(value)) fail(key, 'is { type, provisioning, ... }.')
    const source = value as Record<string, unknown>
    const type = source.type
    if (!SOURCE_TYPES.includes(type as SourceType)) fail(`${key}.type`, `is one of ${SOURCE_TYPES.join(', ')}.`)
    if (type === 'postgres') {
      known(source, key, ['type', 'provisioning', 'url', 'migrationUrl', 'tls', 'tlsCa', 'encryptionKey'])
      const keyRaw = isObject(source.encryptionKey) ? source.encryptionKey : fail(`${key}.encryptionKey`, 'is { file: <path> }: the platform key, 32 random bytes in base64, mounted as a file.')
      known(keyRaw, `${key}.encryptionKey`, ['file', 'id', 'create'])
      if (typeof keyRaw.file !== 'string' || !keyRaw.file.trim()) fail(`${key}.encryptionKey.file`, 'is the path of the platform key file.')
      const create = keyRaw.create === undefined ? false : typeof keyRaw.create === 'boolean' ? keyRaw.create : fail(`${key}.encryptionKey.create`, 'is true or false.')
      const keyPath = from(keyRaw.file as string)
      if (!create && !existsSync(keyPath)) fail(`${key}.encryptionKey.file`, `names ${keyPath}, which does not exist: make one (openssl rand -base64 32 > ${keyPath}), or set create: true to have the server make it on first start.`)
      const tls = source.tls === undefined ? true : typeof source.tls === 'boolean' ? source.tls : fail(`${key}.tls`, 'is true or false.')
      sources[name] = {
        type,
        provisioning: provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled'] as const),
        url: secret(source.url, `${key}.url`),
        migrationUrl: secret(source.migrationUrl, `${key}.migrationUrl`),
        tls,
        tlsCa: source.tlsCa === undefined ? null : (secret(source.tlsCa, `${key}.tlsCa`, { fileOnly: true }) as { file: string }).file,
        encryptionKey: { file: keyPath, id: keyRaw.id === undefined ? 'platform-v1' : string(keyRaw.id, `${key}.encryptionKey.id`), create }
      }
      if (!tls && source.tlsCa !== undefined) fail(`${key}.tlsCa`, 'needs tls: the CA checks a TLS connection.')
    } else if (type === 'neo4j') {
      known(source, key, ['type', 'provisioning', 'isolation', 'url', 'password', 'driver', 'kubernetes'])
      const chosen = provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled', 'managed'] as const)
      if (chosen === 'managed') {
        if (source.driver !== 'kubernetes') fail(`${key}.driver`, 'is kubernetes: a managed graph is a Neo4j pod per account, made through the Kubernetes API.')
        if (source.isolation !== undefined && source.isolation !== 'per-account') fail(`${key}.isolation`, 'is per-account for a managed graph.')
        const kube = isObject(source.kubernetes) ? source.kubernetes : fail(`${key}.kubernetes`, 'is { namespace, image, storageClass, storageSize, issuer, labelDomain }.')
        known(kube, `${key}.kubernetes`, ['namespace', 'image', 'storageClass', 'storageSize', 'issuer', 'labelDomain'])
        sources[name] = {
          type,
          provisioning: chosen,
          isolation: 'per-account',
          url: null,
          password: null,
          kubernetes: {
            namespace: string(kube.namespace, `${key}.kubernetes.namespace`),
            image: optionalString(kube.image, `${key}.kubernetes.image`),
            storageClass: optionalString(kube.storageClass, `${key}.kubernetes.storageClass`),
            storageSize: optionalString(kube.storageSize, `${key}.kubernetes.storageSize`),
            issuer: optionalString(kube.issuer, `${key}.kubernetes.issuer`),
            labelDomain: optionalString(kube.labelDomain, `${key}.kubernetes.labelDomain`)
          }
        }
      } else {
        if (source.isolation !== 'shared') {
          fail(`${key}.isolation`, 'is shared for an external or bundled graph: one Neo4j holds every account, separated by docket scope, so it is for local and evaluation installs; a production install uses provisioning: managed, a Neo4j per account.')
        }
        if (source.driver !== undefined || source.kubernetes !== undefined) fail(`${key}.driver`, 'is only for provisioning: managed.')
        sources[name] = { type, provisioning: chosen, isolation: 'shared', url: url(source.url, `${key}.url`, ['bolt:', 'bolt+s:', 'neo4j:', 'neo4j+s:']), password: secret(source.password, `${key}.password`), kubernetes: null }
      }
    } else if (type === 'qdrant') {
      known(source, key, ['type', 'provisioning', 'url', 'apiKey'])
      sources[name] = { type, provisioning: provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled'] as const), url: url(source.url, `${key}.url`), apiKey: secret(source.apiKey, `${key}.apiKey`) }
    } else if (type === 'embedder') {
      known(source, key, ['type', 'provisioning', 'provider', 'url', 'model', 'dimensions'])
      if (source.provider !== undefined && source.provider !== 'ollama') fail(`${key}.provider`, 'is ollama: the embedding providers this release supports.')
      sources[name] = {
        type,
        provisioning: provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled'] as const),
        provider: 'ollama',
        url: url(source.url, `${key}.url`),
        model: source.model === undefined ? 'nomic-embed-text' : string(source.model, `${key}.model`),
        dimensions: source.dimensions === undefined ? 768 : positive(source.dimensions, `${key}.dimensions`)
      }
    } else if (type === 'reranker') {
      known(source, key, ['type', 'provisioning', 'url'])
      sources[name] = { type, provisioning: provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled'] as const), url: url(source.url, `${key}.url`) }
    } else {
      known(source, key, ['type', 'provisioning', 'url', 'apiKey', 'gatewayKey'])
      sources[name] = {
        type: 'cognee',
        provisioning: provisioning(source.provisioning, `${key}.provisioning`, ['external', 'bundled'] as const),
        url: url(source.url, `${key}.url`),
        apiKey: secret(source.apiKey, `${key}.apiKey`),
        gatewayKey: secret(source.gatewayKey, `${key}.gatewayKey`)
      }
    }
  }

  // Which source each role uses.
  const defaults = raw.defaults === undefined ? {} : isObject(raw.defaults) ? raw.defaults : fail('defaults', 'is { stores }.')
  known(defaults, 'defaults', ['stores'])
  const storesRaw = defaults.stores === undefined ? {} : isObject(defaults.stores) ? defaults.stores : fail('defaults.stores', `is { ${Object.keys(STORE_ROLES).join(', ')} }, each a source's name.`)
  known(storesRaw, 'defaults.stores', Object.keys(STORE_ROLES))
  const pick = <R extends keyof typeof STORE_ROLES>(role: R): Extract<Source, { type: (typeof STORE_ROLES)[R] }> | null => {
    const type = STORE_ROLES[role]
    const named = storesRaw[role]
    if (named === undefined) {
      // One source of the type, and the role is unambiguous.
      const candidates = Object.values(sources).filter((source) => source.type === type)
      if (candidates.length > 1) fail(`defaults.stores.${role}`, `names which ${type} source to use: ${Object.keys(sources).filter((name) => sources[name]?.type === type).join(', ')}.`)
      return (candidates[0] ?? null) as Extract<Source, { type: (typeof STORE_ROLES)[R] }> | null
    }
    const source = typeof named === 'string' ? sources[named] : undefined
    if (!source) return fail(`defaults.stores.${role}`, `names a source in sources, not ${String(named)}.`)
    if (source.type !== type) fail(`defaults.stores.${role}`, `is a ${type} source; ${String(named)} is ${source.type}.`)
    return source as Extract<Source, { type: (typeof STORE_ROLES)[R] }>
  }
  const records = pick('records') ?? fail('defaults.stores.records', 'is the Postgres source the server keeps every account in: add one to sources, with type: postgres.')
  const stores = { records, graph: pick('graph'), search: pick('search'), embedder: pick('embedder'), reranker: pick('reranker'), cognee: pick('cognee') }

  const nameOf = (source: Source) => Object.entries(sources).find(([, candidate]) => candidate === source)?.[0] ?? source.type
  if (environment === 'production' && !records.tls) fail(`sources.${nameOf(records)}.tls`, `is false: plaintext Postgres is refused ${inProduction}.`)
  if (workerMode === 'inline') {
    const missing = (['graph', 'search', 'embedder'] as const).filter((role) => stores[role] === null)
    if (missing.length) {
      fail('worker.mode', `is inline, so the worker needs a source for each of ${missing.join(', ')} (defaults.stores): add them to sources, or set worker.mode: off to run the API alone (search, Ask and projections stay off until a worker runs).`)
    }
  }
  if (environment === 'production' && stores.graph?.isolation === 'shared') fail(`sources.${nameOf(stores.graph)}.isolation`, `is shared, refused ${inProduction}: use provisioning: managed, a Neo4j per account.`)

  // Model providers.
  const aiRaw = raw.ai === undefined ? {} : isObject(raw.ai) ? raw.ai : fail('ai', 'is { providers, primary }.')
  known(aiRaw, 'ai', ['providers', 'primary'])
  const providersRaw = aiRaw.providers === undefined ? {} : isObject(aiRaw.providers) ? aiRaw.providers : fail('ai.providers', 'is a map of named providers: { <name>: { kind: openrouter, apiKey } }.')
  const providers: Record<string, AiProvider> = {}
  for (const [name, value] of Object.entries(providersRaw)) {
    const key = `ai.providers.${name}`
    if (!isObject(value)) fail(key, 'is { kind, apiKey }.')
    const provider = value as Record<string, unknown>
    if (provider.kind !== 'openrouter') {
      fail(`${key}.kind`, `is openrouter: the provider this release's multi-tenant server calls${typeof provider.kind === 'string' ? ` (${provider.kind} is planned, not yet supported)` : ''}.`)
    }
    known(provider, key, ['kind', 'apiKey', 'provisioningKey'])
    const apiKey = provider.apiKey === undefined ? null : secret(provider.apiKey, `${key}.apiKey`)
    const provisioningKey = provider.provisioningKey === undefined ? null : secret(provider.provisioningKey, `${key}.provisioningKey`)
    if (!apiKey && !provisioningKey) fail(key, 'needs an apiKey (one key every account shares), a provisioningKey (a key per account), or both.')
    providers[name] = { kind: 'openrouter', apiKey, provisioningKey }
  }
  const names = Object.keys(providers)
  if (names.length > 1 && aiRaw.primary === undefined) fail('ai.primary', `names the provider the server calls: ${names.join(', ')}.`)
  const primaryName = aiRaw.primary === undefined ? names[0] : string(aiRaw.primary, 'ai.primary')
  const primary = primaryName === undefined ? null : (providers[primaryName] ?? fail('ai.primary', `names a provider in ai.providers, not ${primaryName}.`))

  // Sign-in.
  const authRaw = raw.auth === undefined ? {} : isObject(raw.auth) ? raw.auth : fail('auth', 'is { github, local, access }.')
  known(authRaw, 'auth', ['github', 'local', 'access'])
  let github: PlatformConfig['auth']['github'] = null
  if (authRaw.github !== undefined && authRaw.github !== null) {
    const value = isObject(authRaw.github) ? authRaw.github : fail('auth.github', 'is { clientId, clientSecret }: the GitHub OAuth App people sign in with.')
    known(value, 'auth.github', ['clientId', 'clientSecret', 'oauthUrl', 'apiUrl'])
    github = {
      clientId: string(value.clientId, 'auth.github.clientId'),
      clientSecret: secret(value.clientSecret, 'auth.github.clientSecret'),
      oauthUrl: value.oauthUrl === undefined ? null : url(value.oauthUrl, 'auth.github.oauthUrl'),
      apiUrl: value.apiUrl === undefined ? null : url(value.apiUrl, 'auth.github.apiUrl')
    }
  }
  let local: PlatformConfig['auth']['local'] = null
  if (authRaw.local !== undefined && authRaw.local !== null) {
    const value = isObject(authRaw.local) ? authRaw.local : fail('auth.local', 'is { login }: one-click sign-in as that login, on this machine only.')
    known(value, 'auth.local', ['login'])
    const [login] = logins([value.login], 'auth.local.login')
    if (!loopback) fail('auth.local', `is for a server on this machine only, not one listening on ${host}.`)
    if (environment === 'production') fail('auth.local', `is refused ${inProduction}.`)
    local = { login: login as string }
  }
  if (!github && !local) fail('auth', 'says how people sign in: github (an OAuth App of your own), or local (one login, on this machine only).')
  const accessRaw = authRaw.access === undefined ? {} : isObject(authRaw.access) ? authRaw.access : fail('auth.access', 'is { allow, admins }.')
  known(accessRaw, 'auth.access', ['allow', 'admins'])
  const allow = logins(accessRaw.allow, 'auth.access.allow')
  const admins = logins(accessRaw.admins, 'auth.access.admins')
  if (local) {
    if (!allow.includes(local.login)) allow.push(local.login)
    if (!admins.includes(local.login)) admins.push(local.login)
  }

  // Integrations.
  const integrationsRaw = raw.integrations === undefined ? {} : isObject(raw.integrations) ? raw.integrations : fail('integrations', 'is { github }.')
  known(integrationsRaw, 'integrations', ['github'])
  let githubApp: PlatformConfig['integrations']['githubApp'] = null
  if (integrationsRaw.github !== undefined && integrationsRaw.github !== null) {
    const value = isObject(integrationsRaw.github) && isObject(integrationsRaw.github.app) ? integrationsRaw.github.app : fail('integrations.github', 'is { app: { id, slug, privateKey, webhookSecret } }: the GitHub App repository sync runs as.')
    known(integrationsRaw.github as Record<string, unknown>, 'integrations.github', ['app'])
    known(value, 'integrations.github.app', ['id', 'slug', 'privateKey', 'webhookSecret', 'apiUrl'])
    const id = typeof value.id === 'number' ? String(value.id) : string(value.id, 'integrations.github.app.id')
    if (!/^[0-9]+$/.test(id)) fail('integrations.github.app.id', "is the GitHub App's numeric id.")
    githubApp = {
      id,
      slug: string(value.slug, 'integrations.github.app.slug'),
      privateKey: secret(value.privateKey, 'integrations.github.app.privateKey'),
      webhookSecret: secret(value.webhookSecret, 'integrations.github.app.webhookSecret'),
      apiUrl: value.apiUrl === undefined ? null : url(value.apiUrl, 'integrations.github.app.apiUrl')
    }
  }

  const limitsRaw = raw.limits === undefined ? {} : isObject(raw.limits) ? raw.limits : fail('limits', 'is { accounts }.')
  known(limitsRaw, 'limits', ['accounts'])
  const proxyRaw = raw.proxy === undefined ? {} : isObject(raw.proxy) ? raw.proxy : fail('proxy', 'is { addressHeader, xffDepth }.')
  known(proxyRaw, 'proxy', ['addressHeader', 'xffDepth'])

  return {
    file,
    version: SERVER_CONFIG_VERSION,
    mode: 'multi-tenant',
    listen: { host, port },
    publicUrl,
    environment,
    ui,
    worker: { mode: workerMode },
    sources,
    stores,
    ai: { providers, primary },
    auth: { github, local, access: { allow, admins } },
    integrations: { githubApp },
    limits: { accounts: limitsRaw.accounts === undefined ? null : positive(limitsRaw.accounts, 'limits.accounts') },
    proxy: {
      addressHeader: proxyRaw.addressHeader === undefined ? null : string(proxyRaw.addressHeader, 'proxy.addressHeader'),
      xffDepth: proxyRaw.xffDepth === undefined ? null : positive(proxyRaw.xffDepth, 'proxy.xffDepth')
    }
  }
}

