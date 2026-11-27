import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { ServeConfigError, loadServeConfig } from './config.js'
import { loadPlatformConfig, readServerConfigFile } from './platform-config.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-platform-config-'))
  file = join(dir, 'docket-server.yaml')
  await writeFile(join(dir, 'kek'), 'a'.repeat(44))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The smallest multi-tenant config: one Postgres, local sign-in, no worker. */
const minimal = (): Record<string, unknown> => ({
  version: 1,
  mode: 'multi-tenant',
  worker: { mode: 'off' },
  sources: {
    pg: {
      type: 'postgres',
      url: { env: 'PG_URL' },
      migrationUrl: { env: 'PG_ADMIN_URL' },
      tls: false,
      encryptionKey: { file: './kek' }
    }
  },
  auth: { local: { login: 'alice' } }
})

const env = { PG_URL: 'postgres://app:pw@db/docket', PG_ADMIN_URL: 'postgres://owner:pw@db/docket' }

const load = async (config: Record<string, unknown>, options: Parameters<typeof loadPlatformConfig>[0] = {}) => {
  await writeFile(file, stringify(config))
  return loadPlatformConfig({ file, cwd: dir, env, command: 'open', ...options })
}

const refuses = async (config: Record<string, unknown>, message: RegExp, options: Parameters<typeof loadPlatformConfig>[0] = {}) => {
  const error = await load(config, options).then(
    () => null,
    (cause: unknown) => cause
  )
  expect(error).toBeInstanceOf(ServeConfigError)
  expect((error as Error).message).toMatch(message)
}

describe('the multi-tenant docket-server.yaml', () => {
  it('reads the smallest config: one Postgres, local sign-in, the API alone, on this machine', async () => {
    const config = await load(minimal())
    expect(config).toMatchObject({
      version: 1,
      mode: 'multi-tenant',
      listen: { host: '127.0.0.1', port: 4390 },
      publicUrl: null,
      environment: 'development',
      ui: true,
      worker: { mode: 'off' },
      stores: {
        records: { type: 'postgres', provisioning: 'external', url: { env: 'PG_URL' }, tls: false, encryptionKey: { file: join(dir, 'kek'), id: 'platform-v1', create: false } },
        graph: null,
        search: null
      },
      ai: { providers: {}, primary: null },
      auth: { github: null, local: { login: 'alice' }, access: { allow: ['alice'], admins: ['alice'] } },
      integrations: { githubApp: null }
    })
  })

  it('reads a full install: stores by role, GitHub sign-in and app, a model provider, and the worker inline', async () => {
    for (const name of ['gh-secret', 'app.pem', 'hook', 'qdrant-key', 'neo4j-pw']) await writeFile(join(dir, name), 'x')
    const config = await load({
      ...minimal(),
      listen: { host: '0.0.0.0', port: 8080 },
      publicUrl: 'https://docket.example.com/',
      environment: 'production',
      worker: { mode: 'inline' },
      sources: {
        pg: { type: 'postgres', url: { env: 'PG_URL' }, migrationUrl: { env: 'PG_ADMIN_URL' }, encryptionKey: { file: './kek' } },
        graph: { type: 'neo4j', provisioning: 'managed', driver: 'kubernetes', kubernetes: { namespace: 'docket', storageClass: 'fast' } },
        vectors: { type: 'qdrant', provisioning: 'bundled', url: 'http://qdrant:6333', apiKey: { file: './qdrant-key' } },
        embed: { type: 'embedder', url: 'http://ollama:11434', model: 'nomic-embed-text', dimensions: 768 }
      },
      ai: { providers: { primary: { kind: 'openrouter', apiKey: { env: 'PG_URL' } } } },
      auth: { github: { clientId: 'Iv1.example', clientSecret: { file: './gh-secret' } }, access: { allow: ['@Alice', 'bob'], admins: ['alice'] } },
      integrations: { github: { app: { id: 42, slug: 'docket-example', privateKey: { file: './app.pem' }, webhookSecret: { file: './hook' } } } }
    })
    expect(config.publicUrl).toBe('https://docket.example.com')
    expect(config.stores.graph).toMatchObject({ provisioning: 'managed', isolation: 'per-account', kubernetes: { namespace: 'docket', storageClass: 'fast', image: null } })
    expect(config.stores.search).toMatchObject({ provisioning: 'bundled', url: 'http://qdrant:6333' })
    expect(config.stores.embedder).toMatchObject({ provider: 'ollama', dimensions: 768 })
    expect(config.ai.primary).toEqual({ kind: 'openrouter', apiKey: { env: 'PG_URL' }, provisioningKey: null })
    expect(config.auth.access).toEqual({ allow: ['alice', 'bob'], admins: ['alice'] })
    expect(config.integrations.githubApp).toMatchObject({ id: '42', slug: 'docket-example', privateKey: { file: join(dir, 'app.pem') } })
  })

  it('takes the deployment keys from the environment over the file, and the command line over both', async () => {
    const fromEnv = await load(minimal(), { env: { ...env, DOCKET_SERVE_PORT: '9000', DOCKET_SERVE_UI: 'false', DOCKET_PUBLIC_URL: 'http://localhost:9000' } })
    expect(fromEnv).toMatchObject({ listen: { port: 9000 }, ui: false, publicUrl: 'http://localhost:9000' })
    const fromFlags = await load(minimal(), { env: { ...env, DOCKET_SERVE_PORT: '9000' }, port: 9001, ui: true, worker: 'off' })
    expect(fromFlags).toMatchObject({ listen: { port: 9001 }, ui: true })
  })

  it('never takes a secret written into the file, and checks every reference before anything starts', async () => {
    const plain = minimal()
    ;(plain.sources as Record<string, Record<string, unknown>>).pg!.url = 'postgres://app:pw@db/docket'
    await refuses(plain, /sources\.pg\.url is a secret: \{ file: <path> \} or \{ env: <VARIABLE> \}, never the value itself/)
    await refuses(minimal(), /sources\.pg\.url\.env names PG_URL, which is not set/, { env: { PG_ADMIN_URL: env.PG_ADMIN_URL } })
    const noKey = minimal()
    ;(noKey.sources as Record<string, Record<string, unknown>>).pg!.encryptionKey = { file: './missing' }
    await refuses(noKey, /encryptionKey\.file names .*missing, which does not exist: make one .* or set create: true/)
    ;(noKey.sources as Record<string, Record<string, unknown>>).pg!.encryptionKey = { file: './missing', create: true }
    expect((await load(noKey)).stores.records.encryptionKey).toMatchObject({ file: join(dir, 'missing'), create: true })
  })

  it('refuses what it does not know, rather than ignoring it', async () => {
    await refuses({ ...minimal(), databse: {} }, /databse is not a setting this docket reads/)
    await refuses({ ...minimal(), version: undefined }, /says which version it is written for: version: 1/)
    await refuses({ ...minimal(), version: 2 }, /version 2 is not one this docket reads/)
    await refuses({ ...minimal(), sources: { ...(minimal().sources as object), cache: { type: 'redis' } } }, /sources\.cache\.type is one of postgres, neo4j/)
    await refuses({ ...minimal(), ai: { providers: { local: { kind: 'ollama', url: 'http://localhost:11434' } } } }, /ollama is planned, not yet supported/)
  })

  it('needs every store the worker uses before running it inline, and says how to run the API alone', async () => {
    await refuses({ ...minimal(), worker: { mode: 'inline' } }, /worker needs a source for each of graph, search, embedder \(defaults\.stores\): add them to sources, or set worker\.mode: off/)
    await refuses({ ...minimal(), worker: undefined }, /worker\.mode is inline/)
  })

  it('runs docket serve in production and docket open in development, unless the file says', async () => {
    await refuses(minimal(), /sources\.pg\.tls is false: plaintext Postgres is refused in production \(docket serve runs production unless the file says environment: development\)/, { command: 'serve' })
    expect((await load({ ...minimal(), environment: 'development' }, { command: 'serve' })).environment).toBe('development')
    expect((await load(minimal())).environment).toBe('development')
  })

  it('keeps one shared Neo4j and the local sign-in to installs that are not production', async () => {
    await writeFile(join(dir, 'neo4j-pw'), 'x')
    const shared = { type: 'neo4j', url: 'bolt://localhost:7687', password: { file: './neo4j-pw' } }
    await refuses({ ...minimal(), sources: { ...(minimal().sources as object), graph: shared } }, /isolation is shared for an external or bundled graph/)
    const local = await load({ ...minimal(), sources: { ...(minimal().sources as object), graph: { ...shared, isolation: 'shared' } } })
    expect(local.stores.graph).toMatchObject({ isolation: 'shared', url: 'bolt://localhost:7687' })
    await refuses({ ...minimal(), environment: 'production', sources: { ...(minimal().sources as object), graph: { ...shared, isolation: 'shared' } } }, /plaintext Postgres is refused in production|isolation is shared, refused in production/)
    await refuses({ ...minimal(), environment: 'production' }, /tls is false: plaintext Postgres is refused in production/)
    const overTls = minimal()
    delete (overTls.sources as Record<string, Record<string, unknown>>).pg!.tls
    await refuses({ ...overTls, environment: 'production' }, /auth\.local is refused in production/)
    await refuses({ ...minimal(), listen: { host: '0.0.0.0' }, publicUrl: 'https://docket.example.com' }, /auth\.local is for a server on this machine only/)
    await refuses({ ...minimal(), listen: { host: '0.0.0.0' } }, /publicUrl is needed when the server listens beyond this machine/)
  })

  it('picks the one source of a kind for its role, and asks which when there are several', async () => {
    const two = minimal()
    ;(two.sources as Record<string, unknown>).other = { ...(two.sources as Record<string, Record<string, unknown>>).pg }
    await refuses(two, /defaults\.stores\.records names which postgres source to use: pg, other/)
    expect((await load({ ...two, defaults: { stores: { records: 'other' } } })).stores.records).toMatchObject({ type: 'postgres' })
    await refuses({ ...two, defaults: { stores: { records: 'nowhere' } } }, /names a source in sources, not nowhere/)
  })

  it('tells a single-tenant file from a multi-tenant one, and keeps docket serve token to the single-tenant server', async () => {
    await writeFile(file, stringify(minimal()))
    expect((await readServerConfigFile({ file, cwd: dir, env })).mode).toBe('multi-tenant')
    await expect(loadServeConfig({ file, cwd: dir, env })).rejects.toThrow(/is a multi-tenant server's config: docket serve --config runs it/)
    await writeFile(file, stringify({ version: 1, listen: { port: 4390 } }))
    expect((await readServerConfigFile({ file, cwd: dir, env })).mode).toBe('single')
    expect((await readServerConfigFile({ cwd: join(dir, 'nowhere'), env: {} })).mode).toBe('single')
  })
})
