// SPDX-License-Identifier: AGPL-3.0-only
// Runs Docket Cloud locally against a Postgres container and the fake GitHub:
// what the Playwright suite starts, and a local preview.
//
//   DOCKET_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres node tests/e2e/serve.mjs
//
// Environment:
//   DOCKET_TEST_PG_URL   a superuser URL; the script makes its own database and roles
//   E2E_DB               database name (default docket_e2e); E2E_FRESH=0 keeps an existing one, and its KEK
//   E2E_PORT             the app's port (default 4470); E2E_GITHUB_PORT the fake GitHub's (default 4471)
//   E2E_ALLOWLIST        beta allowlist (default alice,carol)
//   E2E_PLATFORM_ADMINS  who may review the beta waitlist at /admin/waitlist (default alice)
//   E2E_HOST             the host in the app's ORIGIN (default 127.0.0.1); a preview shown through the
//                        Wheelhouse proxy uses localhost, the Origin the proxy sends
//   E2E_DEMO_LOGIN       <login>, like alice: a one-click demo sign-in as that user on the app's own sign-in
//                        page (no password), and the login the fake GitHub suggests; DOCKET_FRAME_ANCESTORS
//                        lets a tool frame the preview.
//                        Both are local-only: the app refuses them for any non-loopback origin or in production
//   DOCKET_PREVIEW_ORIGINS (at build time) http://127.0.0.1:<port> http://localhost:<port>: a preview build
//                        that accepts form posts on both loopback hosts (apps/server/svelte.config.js)
//   E2E_SIGNIN_PER_MINUTE sign-in requests a minute per address (default 1000: the suite signs in often)
//   E2E_OAUTH_PER_MINUTE requests to each OAuth endpoint's limit a minute (default 1000, for the same reason)
//   DOCKET_TEST_NEO4J_URL, DOCKET_TEST_NEO4J_PASSWORD, DOCKET_TEST_QDRANT_URL, DOCKET_TEST_QDRANT_API_KEY
//                        with all four, the worker runs too (repo sync needs it), projecting every org into
//                        that one Neo4j (scoped per workspace; the cluster gives each org its own pod)
//                        and Qdrant, with a fake embedder (tests/fake-embedder)
// The app is the production build (apps/server/build, served by apps/server/server.js): run
// `pnpm --filter @docket/server-platform build` first, and `pnpm --filter @docket/server-worker build` for the
// worker. With the worker, the app reaches its query service (docket_search, docket_ask) on port E2E_PORT+20.
// The fake GitHub also plays the Docket Cloud GitHub App: pushes to its repos
// (POST /_fake/repos/<owner>/<name>/push) reach the app as signed webhooks, and
// the worker syncs them.
import { spawn } from 'node:child_process'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

import { startFakeEmbedder } from '../fake-embedder/server.mjs'
import { startFakeGitHub } from '../fake-github/server.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const superuserUrl = process.env.DOCKET_TEST_PG_URL
if (!superuserUrl) {
  console.error('serve: set DOCKET_TEST_PG_URL to a Postgres superuser URL')
  process.exit(1)
}
const db = process.env.E2E_DB ?? 'docket_e2e'
if (!/^[a-z_][a-z0-9_]{0,40}$/.test(db)) throw new Error('E2E_DB must be a plain identifier')
const owner = `${db}_owner`
const app = `${db}_app`
const fresh = process.env.E2E_FRESH !== '0'
const port = Number(process.env.E2E_PORT ?? 4470)
const githubPort = Number(process.env.E2E_GITHUB_PORT ?? 4471)
const password = `${db}-local-only`

async function prepareDatabase() {
  const client = new pg.Client({ connectionString: superuserUrl })
  await client.connect()
  try {
    const exists = (await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount > 0
    if (exists && !fresh) return
    let orgRoles = []
    if (exists) {
      const inside = new pg.Client({ connectionString: withDatabase(superuserUrl, db) })
      await inside.connect()
      try {
        const { rows } = await inside.query(
          "SELECT 'org_' || id AS role FROM platform.orgs WHERE to_regclass('platform.orgs') IS NOT NULL",
        ).catch(() => ({ rows: [] }))
        orgRoles = rows.map((row) => row.role)
      } finally {
        await inside.end()
      }
      await client.query(`DROP DATABASE "${db}" WITH (FORCE)`)
    }
    for (const role of orgRoles) await client.query(`DROP ROLE IF EXISTS "${role}"`)
    await client.query(`DROP ROLE IF EXISTS "${app}"`)
    await client.query(`DROP ROLE IF EXISTS "${owner}"`)
    // Shaped like the CNPG cluster: an owner that may create roles, and a request role with nothing of its own.
    await client.query(`CREATE ROLE "${owner}" LOGIN CREATEROLE PASSWORD '${password}'`)
    await client.query(`CREATE ROLE "${app}" LOGIN PASSWORD '${password}'`)
    await client.query(`CREATE DATABASE "${db}" OWNER "${owner}"`)
  } finally {
    await client.end()
  }
}

function withDatabase(url, name) {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

await prepareDatabase()
const demoLogin = process.env.E2E_DEMO_LOGIN ?? ''
const origin = `http://${process.env.E2E_HOST ?? '127.0.0.1'}:${port}`
// A throwaway key pair for the fake GitHub App, and a webhook secret: local only, never a real app's.
const appKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const webhookSecret = randomBytes(16).toString('hex')
const github = await startFakeGitHub({
  port: githubPort,
  clientId: 'e2e-client',
  clientSecret: 'e2e-secret',
  demoLogin,
  app: { id: '4242', publicKey: appKeys.publicKey, setupUrl: `${origin}/github/setup` },
  webhook: { url: `${origin}/api/github/webhook`, secret: webhookSecret },
})

// One KEK per database: a kept database (E2E_FRESH=0) needs the KEK its data keys were wrapped with.
const kekFile = join(tmpdir(), `docket-${db}.kek`)
if (fresh || !existsSync(kekFile)) writeFileSync(kekFile, randomBytes(32).toString('base64'), { mode: 0o600 })

const target = new URL(superuserUrl)
const stores = ['DOCKET_TEST_NEO4J_URL', 'DOCKET_TEST_QDRANT_URL'].every((name) => process.env[name])
const queryPort = port + 20
const shared = {
  NODE_ENV: 'development',
  ORIGIN: origin,
  DOCKET_KEK_FILE: kekFile,
  PGHOST: target.hostname,
  PGPORT: target.port || '5432',
  PGDATABASE: db,
  PGUSER: app,
  PGPASSWORD: password,
  PGSSLMODE: 'disable',
  GITHUB_APP_ID: '4242',
  GITHUB_APP_SLUG: 'docket-cloud-e2e',
  GITHUB_APP_PRIVATE_KEY: appKeys.privateKey,
  GITHUB_API_URL: github.url,
  GITHUB_OAUTH_URL: github.url,
}
const child = spawn(process.execPath, [join(root, 'apps/server/server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...shared,
    HOST: '127.0.0.1',
    PORT: String(port),
    DOCKET_PG_ADMIN_USER: owner,
    DOCKET_PG_ADMIN_PASSWORD: password,
    DOCKET_BETA_ALLOWLIST: process.env.E2E_ALLOWLIST ?? 'alice,carol',
    DOCKET_PLATFORM_ADMINS: process.env.E2E_PLATFORM_ADMINS ?? 'alice',
    // The suite makes more orgs than the beta's 8; each test keeps to orgs of its own.
    DOCKET_BETA_ORG_LIMIT: process.env.E2E_ORG_LIMIT ?? '100',
    DOCKET_SIGNIN_PER_MINUTE: process.env.E2E_SIGNIN_PER_MINUTE ?? '1000',
    DOCKET_OAUTH_PER_MINUTE: process.env.E2E_OAUTH_PER_MINUTE ?? '1000',
    DOCKET_OAUTH_TOKEN_PER_MINUTE: process.env.E2E_OAUTH_PER_MINUTE ?? '1000',
    DOCKET_OAUTH_TOKEN_ADDRESS_PER_MINUTE: process.env.E2E_OAUTH_PER_MINUTE ?? '1000',
    DOCKET_OAUTH_REGISTER_PER_MINUTE: process.env.E2E_OAUTH_PER_MINUTE ?? '1000',
    GITHUB_CLIENT_ID: 'e2e-client',
    GITHUB_CLIENT_SECRET: 'e2e-secret',
    GITHUB_WEBHOOK_SECRET: webhookSecret,
    // Pushes wait a second for more to join them, not ten, so a test sees its push quickly.
    DOCKET_PUSH_DEBOUNCE_MS: process.env.DOCKET_PUSH_DEBOUNCE_MS ?? '1000',
    ...(stores ? { DOCKET_QUERY_URL: `http://127.0.0.1:${queryPort}` } : {}),
    ...(demoLogin ? { DOCKET_DEMO_LOGIN: demoLogin } : {}),
  },
})
console.log(`serve: Docket Cloud at ${origin}/ (fake GitHub at ${github.url}, database ${db})`)

// The worker, when there are stores to project into: it projects them and syncs repos.
let worker
let embedder
if (stores) {
  embedder = await startFakeEmbedder({ dimension: 32 })
  worker = spawn(process.execPath, [join(root, 'apps/worker/dist/main.js')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...shared,
      PORT: String(port + 10),
      DOCKET_NEO4J_URL: process.env.DOCKET_TEST_NEO4J_URL,
      DOCKET_NEO4J_PASSWORD: process.env.DOCKET_TEST_NEO4J_PASSWORD ?? '',
      DOCKET_QDRANT_URL: process.env.DOCKET_TEST_QDRANT_URL,
      DOCKET_QDRANT_API_KEY: process.env.DOCKET_TEST_QDRANT_API_KEY ?? '',
      DOCKET_EMBEDDER_URL: embedder.url,
      DOCKET_EMBEDDER_DIMENSION: String(embedder.dimension),
      DOCKET_OUTBOX_POLL_MS: '2000',
      DOCKET_REPO_JOBS_POLL_MS: '500',
      // Background enrichment looks for a run asked for every second, not every minute.
      DOCKET_ENRICHMENT_POLL_MS: '1000',
      // AI stays off, whatever keys the shell holds: nothing local spends real OpenRouter credit.
      OPENROUTER_API_KEY: '',
      OPENROUTER_PROVISIONING_KEY: '',
      // Plain HTTP on loopback: the cluster serves the query service over TLS.
      DOCKET_QUERY_HOST: '127.0.0.1',
      DOCKET_QUERY_PORT: String(queryPort),
    },
  })
  console.log(`serve: worker projecting into ${process.env.DOCKET_TEST_NEO4J_URL} and ${process.env.DOCKET_TEST_QDRANT_URL}`)
}

const stop = () => {
  child.kill('SIGTERM')
  worker?.kill('SIGTERM')
  embedder?.server.close()
  github.server.close()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => {
  worker?.kill('SIGTERM')
  embedder?.server.close()
  github.server.close()
  process.exit(code ?? 0)
})
