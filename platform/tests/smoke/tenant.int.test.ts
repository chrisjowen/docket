// SPDX-License-Identifier: AGPL-3.0-only
// The multi-tenant server as people start it: `docket serve --config docket-server.yaml`, the
// built CLI, against a real Postgres (DOCKET_TEST_PG_URL, a superuser URL) - and, with
// DOCKET_TEST_NEO4J_URL and DOCKET_TEST_QDRANT_URL, the worker in the same process. Needs
// `pnpm build` first.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
`,
    )
  }, 60_000)

  afterAll(async () => {
    embedder?.server.close()
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
      for (const path of ['/', '/o/acme', '/orgs/new']) {
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
})
