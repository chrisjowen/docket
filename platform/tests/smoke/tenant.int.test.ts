// SPDX-License-Identifier: AGPL-3.0-only
// The multi-tenant server as people start it: `docket serve --config docket-server.yaml`, the
// built CLI, against a real Postgres (DOCKET_TEST_PG_URL, a superuser URL) - and, with
// DOCKET_TEST_NEO4J_URL and DOCKET_TEST_QDRANT_URL, the worker in the same process. Needs
// `pnpm build` first.
import { spawn, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startFakeEmbedder } from '../fake-embedder/server.mjs'

const CLI = fileURLToPath(new URL('../../../packages/docket/dist/cli.js', import.meta.url))
const superuser = process.env.DOCKET_TEST_PG_URL
const stores = Boolean(process.env.DOCKET_TEST_NEO4J_URL && process.env.DOCKET_TEST_QDRANT_URL)
const db = `docket_smoke_${process.pid}`
const password = `${db}-local-only`

const withDatabase = (url: string, name: string, user?: string) => {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  if (user) {
    parsed.username = user
    parsed.password = password
  }
  return parsed.toString()
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: superuser })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Runs the CLI until it prints the address it serves, and returns it. */
function serve(args: string[], env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string; output: () => string }> {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`docket did not start:\n${output}`)), 60_000)
    const read = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      const match = /docket serve (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
      if (match?.[1]) {
        clearTimeout(timer)
        done({ child, url: match[1], output: () => output })
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`docket exited (${code}):\n${output}`))
    })
  })
}

async function ready(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${url}/readyz`).catch(() => null)
    if (response?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url}/readyz never answered ready`)
}

/**
 * A fake OpenID provider on loopback: discovery, its key, and a token endpoint
 * that answers with an RS256 ID token for whoever the test says signed in.
 */
async function fakeOidcProvider(): Promise<{ issuer: string; server: Server; next: Record<string, unknown> }> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const idp = { issuer: '', server: createServer(), next: {} as Record<string, unknown> }
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  idp.server.on('request', (req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/.well-known/openid-configuration') {
      return json({ issuer: idp.issuer, authorization_endpoint: `${idp.issuer}/authorize`, token_endpoint: `${idp.issuer}/token`, jwks_uri: `${idp.issuer}/jwks` })
    }
    if (req.url === '/jwks') return json({ keys: [jwk] })
    if (req.url === '/token' && req.method === 'POST') {
      const now = Math.floor(Date.now() / 1000)
      const input = `${part({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${part({ iss: idp.issuer, aud: 'docket', iat: now, exp: now + 300, ...idp.next })}`
      return json({ access_token: 'unused', token_type: 'Bearer', id_token: `${input}.${sign('sha256', Buffer.from(input), privateKey).toString('base64url')}` })
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((done) => idp.server.listen(0, '127.0.0.1', done))
  const address = idp.server.address()
  idp.issuer = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return idp
}

const cookieOf = (response: Response, name: string) => response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0]

const stop = (child: ChildProcess) =>
  new Promise<void>((done) => {
    if (child.exitCode !== null) return done()
    child.once('exit', () => done())
    child.kill('SIGTERM')
  })

describe.skipIf(!superuser)('docket serve --config, multi-tenant', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  let embedder: Awaited<ReturnType<typeof startFakeEmbedder>> | undefined
  let idp: Awaited<ReturnType<typeof fakeOidcProvider>>

  beforeAll(async () => {
    await admin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
      for (const role of [`${db}_app`, `${db}_owner`]) await client.query(`DROP ROLE IF EXISTS "${role}"`)
      // As an installer makes them: a migration role that may create each account's role, and a request role.
      await client.query(`CREATE ROLE "${db}_owner" LOGIN CREATEROLE PASSWORD '${password}'`)
      await client.query(`CREATE ROLE "${db}_app" LOGIN PASSWORD '${password}'`)
      await client.query(`CREATE DATABASE "${db}" OWNER "${db}_owner"`)
    })
    dir = await mkdtemp(join(tmpdir(), 'docket-smoke-'))
    idp = await fakeOidcProvider()
    await writeFile(join(dir, 'ops-password'), 'a smoke-test passphrase\n')
    await writeFile(join(dir, 'oidc-secret'), 'smoke-client-secret')
    env = {
      SMOKE_PG_URL: withDatabase(superuser as string, db, `${db}_app`),
      SMOKE_PG_ADMIN_URL: withDatabase(superuser as string, db, `${db}_owner`),
    }
    if (stores) {
      embedder = await startFakeEmbedder({ dimension: 32 })
      await writeFile(join(dir, 'neo4j-password'), process.env.DOCKET_TEST_NEO4J_PASSWORD ?? '')
      await writeFile(join(dir, 'qdrant-key'), process.env.DOCKET_TEST_QDRANT_API_KEY ?? '')
    }
    // The worker runs in the process when there are stores for it; otherwise the API runs alone.
    const workerSources = stores
      ? `  graph: { type: neo4j, isolation: shared, url: ${process.env.DOCKET_TEST_NEO4J_URL}, password: { file: ./neo4j-password } }
  vectors: { type: qdrant, url: ${process.env.DOCKET_TEST_QDRANT_URL}, apiKey: { file: ./qdrant-key } }
  embed: { type: embedder, url: ${embedder?.url}, dimensions: 32 }
`
      : ''
    await writeFile(
      join(dir, 'docket-server.yaml'),
      `version: 1
mode: multi-tenant
environment: development
listen: { host: 127.0.0.1, port: 0 }
worker: { mode: ${stores ? 'inline' : 'off'} }
sources:
  pg:
    type: postgres
    url: { env: SMOKE_PG_URL }
    migrationUrl: { env: SMOKE_PG_ADMIN_URL }
    tls: false
    encryptionKey: { file: ./kek, create: true }
${workerSources}auth:
  local: { login: alice }
  oidc:
    dev: { issuer: ${idp.issuer}, clientId: docket, clientSecret: { file: ./oidc-secret }, label: Dev SSO }
  password:
    users:
      - { login: ops.admin, password: { file: ./ops-password }, email: ops@example.com }
  access: { allow: ['@example.com'] }
`,
    )
  }, 60_000)

  afterAll(async () => {
    embedder?.server.close()
    idp?.server.close()
    if (dir) await rm(dir, { recursive: true, force: true })
    await admin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)
      // The smoke makes no account, so the two roles are all it leaves.
      for (const role of [`${db}_app`, `${db}_owner`]) await client.query(`DROP ROLE IF EXISTS "${role}"`)
    })
  }, 60_000)

  it('boots the API, OAuth, sign-in and the app in one process, migrated and ready', async () => {
    const { child, url, output } = await serve(['serve', '--config', join(dir, 'docket-server.yaml')], env)
    try {
      await ready(url)
      expect(output()).toContain(stores ? 'worker  in this process' : 'worker  off')
      const readyz = await (await fetch(`${url}/readyz`)).json()
      expect(readyz).toEqual({ ok: true, checks: { postgres: 'ok', kek: 'ok' } })
      // A visitor is sent to sign in, where the local sign-in is offered.
      const home = await fetch(`${url}/`, { redirect: 'manual' })
      expect(home.status).toBe(303)
      expect(home.headers.get('location')).toBe('/signin')
      expect(await (await fetch(`${url}/signin`)).text()).toContain('Sign in as demo user (alice)')
      // Docket's own authorization server, at the server's origin.
      const metadata = (await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json()) as { issuer: string; token_endpoint: string }
      expect(metadata.issuer).toBe(url)
      expect(metadata.token_endpoint).toBe(`${url}/oauth/token`)
      // MCP asks for a credential, pointing at its protected-resource metadata.
      const mcp = await fetch(`${url}/mcp/acme/platform`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(mcp.status).toBe(401)
      expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=')
      if (stores) {
        await expect.poll(output, { timeout: 30_000 }).toContain('worker up:')
      }
    } finally {
      await stop(child)
    }
  }, 120_000)

  it('runs headless with --no-ui: the API and sign-in answer, the product pages do not', async () => {
    const { child, url } = await serve(['serve', '--config', join(dir, 'docket-server.yaml'), '--no-ui', '--no-worker'], env)
    try {
      await ready(url)
      for (const path of ['/', '/a/acme', '/orgs/new']) {
        const response = await fetch(`${url}${path}`, { redirect: 'manual' })
        expect(response.status, path).toBe(404)
        expect(await response.text()).toContain('headless')
      }
      expect((await fetch(`${url}/signin`)).status).toBe(200)
      expect((await fetch(`${url}/.well-known/oauth-authorization-server`)).status).toBe(200)
    } finally {
      await stop(child)
    }
  }, 120_000)

  it('signs people in with a password and with OIDC, each a user of the same platform', async () => {
    const { child, url } = await serve(['serve', '--config', join(dir, 'docket-server.yaml'), '--no-worker'], env)
    try {
      await ready(url)
      const page = await (await fetch(`${url}/signin`)).text()
      expect(page).toContain('Continue with Dev SSO')
      expect(page).toContain('Sign in with password')

      const password = (login: string, secret: string) =>
        fetch(`${url}/signin?/password`, {
          method: 'POST',
          redirect: 'manual',
          // As a browser posts the form: SvelteKit answers a script's post with JSON instead.
          headers: { origin: url, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ login, password: secret, next: '/' }),
        })
      const wrong = await password('ops.admin', 'not the passphrase')
      expect(wrong.status).toBe(403)
      expect(cookieOf(wrong, 'docket_session')).toBeUndefined()
      const right = await password('ops.admin', 'a smoke-test passphrase')
      expect(right.status).toBe(303)
      const session = cookieOf(right, 'docket_session')
      expect(session).toBeDefined()
      const home = await fetch(`${url}/`, { redirect: 'manual', headers: { cookie: session as string } })
      expect(home.headers.get('location')).not.toBe('/signin')

      // OIDC: off to the provider with a state and nonce, and back with a code.
      const oidc = async (claims: Record<string, unknown>) => {
        const start = await fetch(`${url}/auth/oidc/dev?next=/`, { redirect: 'manual' })
        expect(start.status).toBe(302)
        const authorize = new URL(start.headers.get('location') as string)
        expect(authorize.origin).toBe(idp.issuer)
        idp.next = { ...claims, nonce: authorize.searchParams.get('nonce') }
        return fetch(`${url}/auth/oidc/dev/callback?code=smoke&state=${authorize.searchParams.get('state')}`, {
          redirect: 'manual',
          headers: { cookie: cookieOf(start, 'docket_oidc') as string },
        })
      }
      const admitted = await oidc({ sub: 'sso-jo', email: 'jo@example.com', email_verified: true, preferred_username: 'jo', name: 'Jo' })
      expect(admitted.headers.get('location')).toBe('/')
      expect(cookieOf(admitted, 'docket_session')).toBeDefined()
      // Outside the allowed domain, and not invited.
      const refused = await oidc({ sub: 'sso-stranger', email: 'stranger@elsewhere.example', email_verified: true })
      expect(refused.headers.get('location')).toBe('/signin?error=not-invited')
      expect(cookieOf(refused, 'docket_session')).toBeUndefined()

      const rows = await admin(async () => {
        const client = new pg.Client({ connectionString: withDatabase(superuser as string, db) })
        await client.connect()
        try {
          return (await client.query<{ login: string; provider: string }>('SELECT u.login, i.provider FROM platform.users u JOIN platform.identities i ON i.user_id = u.id ORDER BY u.login')).rows
        } finally {
          await client.end()
        }
      })
      expect(rows).toEqual([
        { login: 'jo.dev', provider: 'oidc' },
        { login: 'ops.admin', provider: 'password' },
      ])
    } finally {
      await stop(child)
    }
  }, 120_000)
})
