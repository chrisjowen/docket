import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openDocket, readGraph, type MemoryAdapter } from '@chrisjowen/docket'
import { CONFIG_FILENAME, findConfigFile, loadConfig, readViews, summarizerFor, type ResolvedConfig } from '@chrisjowen/docket/host'
import { stringify } from 'yaml'

import { localKeyCodec, plaintextCodec } from '../codecs.js'
import { ModelCallRefused } from '../mcp/context.js'
import { QueryError, type QueryClient } from '../mcp/query.js'
import type { DocumentCodec, StoreRunner, StoreScope } from '../ports.js'
import { enqueue, migrate, postgresSource, postgresStore, pushDocuments, setOntologyMcpRoles, workspaceBySlug, createWorkspace, listDocumentPage, type Pool } from '../postgres/index.js'
import { outboxLoop, type OutboxLoop } from '../runtime/outbox.js'
import { reconciler, type ProjectionSet } from '../runtime/reconcile.js'
import { queryService, QueryFailure } from '../runtime/search.js'
import type { ServeBackend, ServedWorkspace } from './backend.js'
import type { ServeConfig } from './config.js'

/*
 * `docket serve` over a Postgres canonical store, opted into with
 * `database.url` (or DOCKET_DATABASE_URL): the same store, tools and loops as
 * Docket Cloud's, in one schema, with one workspace per configured slug. Writes
 * are serialised by the store's locks and `expectedHead`; the outbox loop
 * projects them into the configured projections (jsonl unless the config
 * says otherwise), and searches and questions are answered in-process.
 */

/** What `docket_ask` answers without a model, over files and Postgres alike. */
export const ASK_OFF = 'docket_ask is off on this server: it has no model to answer with. Use docket_search, which needs none.'

const quiet = { info: () => undefined, error: (message: string) => console.error(`docket serve: ${message}`) }

/** Reads the codec's key: 32 raw bytes, or 64 hex digits, or base64 of 32 bytes. */
async function codecOf(config: ServeConfig): Promise<DocumentCodec> {
  if (config.codec.kind === 'plaintext') return plaintextCodec()
  const text = await readFile(config.codec.file)
  const trimmed = text.toString('utf8').trim()
  const key = text.length === 32 ? text : /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64')
  return localKeyCodec({ key })
}

/**
 * A workspace's projections: docket adapter instances, set up in a
 * directory of their own under the server's data directory, so a jsonl or
 * SQLite index lives there.
 */
async function projectionHome(config: ServeConfig, slug: string): Promise<ResolvedConfig> {
  const home = join(config.dataDir, 'index', slug)
  await mkdir(join(home, '.docket'), { recursive: true })
  const text = stringify({
    version: 2,
    source: { root: '.docket' },
    adapters: config.projections.map((projection) => ({ id: projection.id, module: projection.module, roles: ['projection', 'query'], config: projection.config }))
  })
  await writeFile(join(home, CONFIG_FILENAME), `# Written by docket serve from its projections: changes here are replaced on start.\n${text}`, 'utf8')
  return loadConfig(home)
}

/** The ontology a new workspace starts with: its configured file, else its project's, else docket's default template. */
async function startOf(entry: ServeConfig['workspaces'][number]): Promise<{ importYaml: string } | { template: 'sdlc' }> {
  if (entry.ontology) return { importYaml: await readFile(entry.ontology, 'utf8') }
  if (entry.path && findConfigFile(entry.path)) {
    const resolved = await loadConfig(entry.path)
    try {
      return { importYaml: await readFile(resolved.ontologyPath, 'utf8') }
    } catch {
      // No ontology file: the template.
    }
  }
  return { template: 'sdlc' }
}

export async function postgresBackend(config: ServeConfig, options: { pool?: Pool & { end(): Promise<void> }; loopIntervalMs?: number } = {}): Promise<ServeBackend> {
  const database = config.database
  if (!database) throw new Error('postgresBackend needs database.url')
  let pool = options.pool
  if (!pool) {
    let pg: typeof import('pg')
    try {
      pg = (await import('pg')).default as unknown as typeof import('pg')
    } catch {
      throw new Error('docket serve needs the pg package for a Postgres database: npm install -g pg (or install it beside docket).')
    }
    pool = new pg.Pool({ connectionString: database.url, max: 10 }) as unknown as Pool & { end(): Promise<void> }
  }
  const owned = options.pool === undefined
  // The postgres projection reads its URL from DOCKET_DATABASE_URL, never from a file: the server's own, however it was given.
  process.env.DOCKET_DATABASE_URL ??= database.url
  const schema = database.schema
  await migrate(pool, { schema })
  const store: StoreRunner = postgresStore({ pool, schema, codec: await codecOf(config) })
  const scope: StoreScope = { id: 'docket-serve', store }

  // One workspace per configured slug, made on first start; the server's ontology.mcpWriters is each one's setting.
  const workspaces: ServedWorkspace[] = []
  for (const entry of config.workspaces) {
    const existing = await store.run((ctx) => workspaceBySlug(ctx.tx, entry.slug))
    const id =
      existing?.id ??
      (await store.run(async (ctx) => {
        const { workspace } = await createWorkspace(ctx, { name: entry.slug, slug: entry.slug, start: await startOf(entry), publisher: { actor: 'docket-serve', login: 'docket serve' } })
        return workspace.id
      }))
    await store.run((ctx) => setOntologyMcpRoles(ctx.tx, id, config.ontology.mcpWriters))
    workspaces.push({ slug: entry.slug, id })
  }

  // Each workspace's projections, opened from its projection home.
  const homes = new Map<string, ResolvedConfig>()
  for (const workspace of workspaces) homes.set(workspace.id, await projectionHome(config, workspace.slug))
  const instances = config.projections.map((projection) => projection.id)
  const slotsOf = async (workspaceId: string) => {
    const home = homes.get(workspaceId)
    if (!home) throw new QueryFailure(404, 'No such workspace.')
    return (await openDocket(home)).adapters
  }
  const projections: ProjectionSet = {
    instances,
    async connect(_scope, workspaceId) {
      const slots = await slotsOf(workspaceId)
      const slot = (instance: string) => {
        const found = slots.find((each) => each.id === instance)
        if (!found) throw new Error(`no projection ${instance}`)
        return found
      }
      return { fingerprint: (instance) => slot(instance).fingerprint, open: (instance) => slot(instance).create() }
    }
  }
  const loop: OutboxLoop = outboxLoop({
    scopes: { scopes: async () => [scope] },
    pool,
    reconciler: reconciler({ projections }),
    instances,
    log: quiet,
    ...(options.loopIntervalMs !== undefined ? { intervalMs: options.loopIntervalMs } : {})
  })
  loop.start()

  const model = config.ai ? summarizerFor(config.ai) : null
  const service = queryService({
    store: () => store,
    async projections(query) {
      const slots = await slotsOf(query.workspaceId)
      const adapters: Record<string, MemoryAdapter> = {}
      for (const slot of slots) adapters[slot.id] = await slot.create()
      return { adapters, close: async () => void (await Promise.all(Object.values(adapters).map((adapter) => adapter.close().catch(() => undefined)))) }
    },
    instances,
    reranker: null,
    ...(model ? { models: () => ({ synthesis: { model: model.name, chat: model.chat } }) } : {}),
    log: quiet
  })
  const query: QueryClient = {
    search: (asked) =>
      service.search(asked).catch((cause: unknown) => {
        throw cause instanceof QueryFailure ? new QueryError(cause.status, cause.message) : cause
      }),
    ask: (asked) =>
      service.ask(asked).catch((cause: unknown) => {
        throw cause instanceof QueryFailure ? new QueryError(cause.status, cause.message) : cause
      })
  }

  /** Whether every write so far has been projected: nothing left in the workspace's outbox. */
  const caughtUp = async (workspaceId: string) =>
    store.run(async ({ tx }) => {
      const { rows } = await tx.query<{ pending: string }>('SELECT count(*) AS pending FROM outbox WHERE workspace_id = $1 AND processed_at IS NULL', [workspaceId])
      return Number(rows[0]?.pending ?? 0) === 0
    })
  const waitFor = async (workspaceId: string, ms = 30_000) => {
    const deadline = Date.now() + ms
    while (!(await caughtUp(workspaceId))) {
      if (Date.now() > deadline) throw new Error('The projections did not catch up in time.')
      loop.kick()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }


  return {
    kind: 'postgres',
    workspaces,
    mcp(workspace) {
      return {
        store: () => store,
        query: () => query,
        // Without a model, docket_ask says it is off, as it does over files.
        ...(model
          ? {}
          : {
              modelGate: {
                beforeModelCall: async () => {
                  throw new ModelCallRefused(ASK_OFF)
                }
              }
            })
      }
    },
    written() {
      loop.kick()
    },
    async documents(workspace, page) {
      const listed = await store.run((ctx) =>
        listDocumentPage(ctx, {
          workspaceId: workspace.id,
          origin: page.origin,
          ...(page.originRef !== undefined ? { originRef: page.originRef } : {}),
          ...(page.after !== undefined ? { after: page.after } : {}),
          limit: page.limit,
          raw: page.raw === true
        })
      )
      return {
        documents: listed.documents.map((document) => ({ ...document, updatedAt: document.updatedAt.toISOString() })),
        ...(listed.next ? { next: listed.next } : {})
      }
    },
    async push(workspace, writer, request, dryRun) {
      const result = await store.run((ctx) =>
        pushDocuments(ctx, { workspaceId: workspace.id, actor: writer.actor, label: writer.label, channel: 'cli', requestId: writer.requestId }, request, { dryRun })
      )
      if (result.ok && !dryRun) loop.kick()
      const { ok, created, updated, unchanged, removed, diagnostics } = result
      return { ok, dryRun, created, updated, unchanged, removed, diagnostics }
    },
    readViews(workspace) {
      // The page itself is docket open's; of its reads, the graph is read from the store, and the rest are not served over Postgres yet.
      const home = homes.get(workspace.id) as ResolvedConfig
      const page = readViews({ cwd: home.projectRoot, refusal: 'docket serve keeps this index in sync after every write.' })
      return async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const json = (status: number, body: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(JSON.stringify(body))
        }
        if (url.pathname === '/api/graph') return json(200, await store.run((ctx) => readGraph(postgresSource(ctx, workspace.id))))
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          return json(501, { error: `${url.pathname} is not served by a Postgres-backed docket serve yet: browse the graph, and ask over MCP.` })
        }
        await page(request, response)
      }
    },
    async indexed(workspace) {
      await waitFor(workspace.id)
    },
    async rebuild(workspace) {
      await store.run(({ tx }) => enqueue(tx, workspace.id, 'rebuild'))
      loop.kick()
      await waitFor(workspace.id)
    },
    async ready() {
      try {
        await store.run(({ tx }) => tx.query('SELECT 1'))
        return { ok: true, detail: `${workspaces.length} workspace(s) on Postgres` }
      } catch (cause) {
        return { ok: false, detail: `the database is not reachable: ${cause instanceof Error ? cause.message : String(cause)}` }
      }
    },
    async close() {
      await loop.stop()
      if (owned) await pool.end()
    }
  }
}
