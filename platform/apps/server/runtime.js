// SPDX-License-Identifier: AGPL-3.0-only
// The multi-tenant server in one process, as `docket serve` and `docket open --config` run it:
// the API, MCP, OAuth and (unless headless) the product's pages on one listener, and the
// worker beside them unless the config turns it off. It takes the checked config
// (`loadPlatformConfig` in @chrisjowen/docket-server/serve) and sets the environment the
// app and the worker read (the variables server.js and the worker's main.ts document),
// so a container started with those variables and one started from a docket-server.yaml
// run the same code.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { frontListener } from './front.js'

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
const WILDCARD = new Set(['0.0.0.0', '::'])

/** A secret's value: a file's contents, trimmed, or a variable's. Never logged. */
async function secret(ref, env) {
  if ('file' in ref) return (await readFile(ref.file, 'utf8')).trim()
  const value = env[ref.env]
  if (!value) throw new Error(`${ref.env} is not set`)
  return value
}

/** A free TCP port on `host`, for a listener asked for port 0 or the worker's query service. */
function freePort(host) {
  return new Promise((done, fail) => {
    const probe = createNetServer()
    probe.once('error', fail)
    probe.listen(0, host, () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

/** The platform key, made once when the config asks for it (`encryptionKey.create`) and kept beside the data it unlocks. */
async function ensureKek(encryptionKey, log) {
  if (existsSync(encryptionKey.file)) return
  if (!encryptionKey.create) throw new Error(`the platform key ${encryptionKey.file} does not exist`)
  await mkdir(dirname(encryptionKey.file), { recursive: true })
  await writeFile(encryptionKey.file, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
  log(`made a new platform key at ${encryptionKey.file}: back it up with the database, which cannot be read without it`)
}

/**
 * The environment the app and the worker read, from the checked config. Secrets are read
 * here, server-side; a file the app reads itself (the KEK, the CA, the GitHub App's key)
 * is passed by path.
 */
export async function platformEnv(config, { env = process.env, origin }) {
  const out = { NODE_ENV: config.environment, ORIGIN: origin }
  const pg = config.stores.records
  const request = new URL(await secret(pg.url, env))
  const migration = new URL(await secret(pg.migrationUrl, env))
  for (const url of [request, migration]) {
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('the Postgres source\'s url and migrationUrl are postgres:// URLs')
  }
  const database = (url) => decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (request.hostname !== migration.hostname || (request.port || '5432') !== (migration.port || '5432') || database(request) !== database(migration)) {
    throw new Error('the Postgres source\'s migrationUrl is the same server and database as its url, with the migration role\'s name and password')
  }
  if (!request.username || !migration.username) throw new Error('the Postgres source\'s url and migrationUrl each name their role')
  Object.assign(out, {
    PGHOST: request.hostname,
    PGPORT: request.port || '5432',
    PGDATABASE: database(request),
    PGUSER: decodeURIComponent(request.username),
    PGPASSWORD: decodeURIComponent(request.password),
    DOCKET_PG_APP_ROLE: decodeURIComponent(request.username),
    DOCKET_PG_ADMIN_USER: decodeURIComponent(migration.username),
    DOCKET_PG_ADMIN_PASSWORD: decodeURIComponent(migration.password),
    DOCKET_KEK_FILE: pg.encryptionKey.file,
    DOCKET_KEK_ID: pg.encryptionKey.id,
  })
  if (!pg.tls) out.PGSSLMODE = 'disable'
  if (pg.tlsCa) out.PGSSLROOTCERT = pg.tlsCa

  const { github, local, access } = config.auth
  if (github) {
    out.GITHUB_CLIENT_ID = github.clientId
    out.GITHUB_CLIENT_SECRET = await secret(github.clientSecret, env)
    if (github.oauthUrl) out.GITHUB_OAUTH_URL = github.oauthUrl
    if (github.apiUrl) out.GITHUB_API_URL = github.apiUrl
  }
  if (local) out.DOCKET_DEMO_LOGIN = local.login
  out.DOCKET_BETA_ALLOWLIST = access.allow.join(',')
  out.DOCKET_PLATFORM_ADMINS = access.admins.join(',')

  const app = config.integrations.githubApp
  if (app) {
    out.GITHUB_APP_ID = app.id
    out.GITHUB_APP_SLUG = app.slug
    if ('file' in app.privateKey) out.GITHUB_APP_PRIVATE_KEY_FILE = app.privateKey.file
    else out.GITHUB_APP_PRIVATE_KEY = await secret(app.privateKey, env)
    if ('file' in app.webhookSecret) out.GITHUB_WEBHOOK_SECRET_FILE = app.webhookSecret.file
    else out.GITHUB_WEBHOOK_SECRET = await secret(app.webhookSecret, env)
    if (app.apiUrl) out.GITHUB_API_URL = app.apiUrl
  }

  // AI stays off without a provider, whatever keys the shell holds.
  const ai = config.ai.primary
  out.OPENROUTER_API_KEY = ai?.apiKey ? await secret(ai.apiKey, env) : ''
  out.OPENROUTER_PROVISIONING_KEY = ai?.provisioningKey ? await secret(ai.provisioningKey, env) : ''

  if (config.limits.accounts !== null) out.DOCKET_BETA_ORG_LIMIT = String(config.limits.accounts)
  if (config.proxy.addressHeader) out.ADDRESS_HEADER = config.proxy.addressHeader
  if (config.proxy.xffDepth !== null) out.XFF_DEPTH = String(config.proxy.xffDepth)

  // The worker's stores.
  const { graph, search, embedder, reranker, cognee } = config.stores
  if (graph?.isolation === 'shared') {
    out.DOCKET_NEO4J_URL = graph.url
    out.DOCKET_NEO4J_PASSWORD = await secret(graph.password, env)
  } else if (graph) {
    const kube = graph.kubernetes
    out.DOCKET_NAMESPACE = kube.namespace
    if (kube.image) out.DOCKET_NEO4J_IMAGE = kube.image
    if (kube.storageClass) out.DOCKET_NEO4J_STORAGE_CLASS = kube.storageClass
    if (kube.storageSize) out.DOCKET_NEO4J_STORAGE_SIZE = kube.storageSize
    if (kube.issuer) out.DOCKET_NEO4J_ISSUER = kube.issuer
    if (kube.labelDomain) out.DOCKET_K8S_LABEL_DOMAIN = kube.labelDomain
  }
  if (search) {
    out.DOCKET_QDRANT_URL = search.url
    out.DOCKET_QDRANT_API_KEY = await secret(search.apiKey, env)
  }
  if (embedder) {
    out.DOCKET_EMBEDDER_URL = embedder.url
    out.DOCKET_EMBEDDER_MODEL = embedder.model
    out.DOCKET_EMBEDDER_DIMENSION = String(embedder.dimensions)
  }
  if (reranker) out.DOCKET_RERANKER_URL = reranker.url
  if (cognee) {
    out.DOCKET_COGNEE_ENABLED = 'true'
    out.DOCKET_COGNEE_URL = cognee.url
    out.DOCKET_COGNEE_API_KEY = await secret(cognee.apiKey, env)
    out.DOCKET_COGNIFY_GATEWAY_KEY = await secret(cognee.gatewayKey, env)
  }
  return out
}

/**
 * Starts the multi-tenant server from a checked config (`loadPlatformConfig`, which settles
 * its environment: production for `docket serve`, development for `docket open`). Returns its
 * URL and a `close` that drains the listener and stops the worker.
 */
export async function startPlatform(config, { env = process.env, log = (line) => console.log(line) } = {}) {
  const { host } = config.listen
  const port = config.listen.port || (await freePort(WILDCARD.has(host) ? '127.0.0.1' : host))
  const reach = WILDCARD.has(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host
  const url = `http://${reach}:${port}`
  const origin = config.publicUrl ?? url
  await ensureKek(config.stores.records.encryptionKey, log)
  const settings = await platformEnv(config, { env, origin })
  const inline = config.worker.mode === 'inline'
  if (inline) {
    // The worker's query service, on loopback in this process: plain HTTP, sealed with the KEK.
    const queryPort = await freePort('127.0.0.1')
    Object.assign(settings, { DOCKET_QUERY_HOST: '127.0.0.1', DOCKET_QUERY_PORT: String(queryPort), DOCKET_QUERY_URL: `http://127.0.0.1:${queryPort}` })
  }
  // The app and the worker read process.env: set it before either is loaded.
  Object.assign(process.env, settings, { HOST: host, PORT: String(port) })
  process.env.DOCKET_MCP_APP ??= fileURLToPath(new URL('./build/mcp-app/search.html', import.meta.url))

  const { handler } = await import('./build/handler.js')
  const server = createServer(frontListener({ handler, origin, ui: config.ui }))
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      server.off('error', fail)
      done()
    })
  })

  // The worker waits for the API to migrate, so it starts behind the listener; if it cannot, the API keeps serving.
  const worker = inline
    ? import('@docket/server-worker/run')
        .then(({ startWorker }) => startWorker({ env: process.env, healthPort: null }))
        .catch((error) => {
          log(`worker failed to start: ${error instanceof Error ? error.message : String(error)}; the API keeps serving without it`)
          return null
        })
    : Promise.resolve(null)

  let closing = null
  const close = () =>
    (closing ??= (async () => {
      await new Promise((done) => {
        server.close(() => done())
        server.closeIdleConnections()
        setTimeout(done, 30_000).unref()
      })
      await (await worker)?.stop()
    })())
  return {
    url: config.publicUrl ?? url,
    port,
    local: LOOPBACK.has(host),
    worker: inline ? 'inline' : 'off',
    ui: config.ui,
    close,
  }
}
