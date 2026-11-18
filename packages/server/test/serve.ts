import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ONTOLOGY_TEMPLATES } from '@chrisjowen/docket'
import pg from 'pg'

import { ident } from '../src/postgres/db.js'
import { createToken, loadServeConfig, startServe, type RunningServe, type ServeConfig } from '../src/serve/index.js'
import { TEST_PG_URL } from './postgres.js'

/**
 * `docket serve` for the tests: a project to serve, made the way `docket
 * init` makes one (the default ontology, jsonl projections), and a server
 * over it - its files, or a throwaway Postgres database - with an owner's and
 * an editor's token.
 */

export const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
---

Takes orders at checkout.
`

export const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

const CONFIG = `version: 2
source:
  root: .docket
  include: ["**/*.md"]
  exclude: [".index/**", ".cache/**"]
ontology:
  file: .docket/entities.yaml
adapters:
  - id: local
    module: "@docket/adapter-jsonl"
    roles: [projection, query]
    config:
      output: .docket/.index
query:
  synthesis: false
`

/** A project with docket's default ontology, a team and a service. */
export async function makeProject(prefix = 'docket-serve-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, '.docket/resources/services'), { recursive: true })
  await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
  await writeFile(join(root, '.docket.yaml'), CONFIG, 'utf8')
  await copyFile(ONTOLOGY_TEMPLATES.sdlc as string, join(root, '.docket/entities.yaml'))
  await writeFile(join(root, '.docket/resources/services/orders.md'), ORDERS, 'utf8')
  await writeFile(join(root, '.docket/resources/teams/payments.md'), PAYMENTS, 'utf8')
  return root
}

/** A new database for one suite, and how to drop it. */
export async function makeDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  if (!TEST_PG_URL) throw new Error('DOCKET_TEST_PG_URL is not set')
  const database = `docket_s${randomBytes(5).toString('hex')}`
  const root = new pg.Client({ connectionString: TEST_PG_URL })
  await root.connect()
  try {
    await root.query(`CREATE DATABASE ${ident(database)}`)
  } finally {
    await root.end()
  }
  const url = new URL(TEST_PG_URL)
  url.pathname = `/${database}`
  return {
    url: url.toString(),
    async drop() {
      const client = new pg.Client({ connectionString: TEST_PG_URL })
      await client.connect()
      try {
        await client.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`)
      } finally {
        await client.end()
      }
    }
  }
}

export type StoreKind = 'files' | 'postgres'

export interface TestServe {
  kind: StoreKind
  project: string
  config: ServeConfig
  running: RunningServe
  tokens: { owner: string; editor: string }
  /** The workspace's MCP URL. */
  mcpUrl: string
  /** One JSON-RPC call over HTTP with a token: the status and the parsed body. */
  rpc(token: string, method: string, params?: unknown): Promise<{ status: number; body: Record<string, any> }>
  /** A tools/call's result. */
  call(token: string, name: string, args: unknown): Promise<{ status: number; result: Record<string, any> | undefined; error?: Record<string, any>; text: string }>
  close(): Promise<void>
}

/** A server over a new project, from the project's files or a new database, with an owner's and an editor's token. */
export async function startTestServe(
  kind: StoreKind,
  options: { env?: Record<string, string>; project?: string; database?: string; dataDir?: string } = {}
): Promise<TestServe> {
  const project = options.project ?? (await makeProject())
  const env: NodeJS.ProcessEnv = {
    DOCKET_DATA_DIR: options.dataDir ?? join(project, '.docket-server'),
    ...(kind === 'postgres' ? { DOCKET_DATABASE_URL: options.database as string } : {}),
    ...options.env
  }
  const config = await loadServeConfig({ cwd: project, env, port: 0 })
  const tokens = {
    owner: (await createToken(config, { name: `owner-${randomBytes(3).toString('hex')}`, role: 'owner' })).token,
    editor: (await createToken(config, { name: `editor-${randomBytes(3).toString('hex')}`, role: 'editor' })).token
  }
  const running = await startServe(config, { syncIntervalMs: 0, loopIntervalMs: 200 })
  const slug = config.workspaces[0]?.slug as string
  const mcpUrl = `${running.url}/mcp/${slug}`
  let id = 1
  const rpc: TestServe['rpc'] = async (token, method, params = {}) => {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params })
    })
    const text = await response.text()
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} }
  }
  return {
    kind,
    project,
    config,
    running,
    tokens,
    mcpUrl,
    rpc,
    async call(token, name, args) {
      const { status, body } = await rpc(token, 'tools/call', { name, arguments: args })
      const result = body.result as Record<string, any> | undefined
      return { status, result, ...(body.error ? { error: body.error } : {}), text: (result?.content?.[0]?.text as string | undefined) ?? '' }
    },
    async close() {
      await running.close()
      if (!options.project) await rm(project, { recursive: true, force: true })
    }
  }
}

export const STORES: readonly { kind: StoreKind; skip: boolean }[] = [
  { kind: 'files', skip: false },
  { kind: 'postgres', skip: !TEST_PG_URL }
]
