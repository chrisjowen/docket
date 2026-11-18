import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { MemoryAdapter } from '@docket/contracts'
import { parse, stringify } from 'yaml'

import { createDocket } from '../../src/adapters/docket.js'
import { sync } from '../../src/commands/sync.js'
import { ANSWER_LIMIT, type Strategy } from './strategies.js'

/*
 * The Postgres and SQLite adapters as projectors (README.md): a corpus's
 * docket synced through @docket/adapter-postgres or @docket/adapter-sqlite -
 * embedding through Ollama included, for a hybrid instance - and each query
 * answered with the adapter's own ask. Only the entities its answer names
 * count, best first, as for cognee; the paths it adds are context.
 */

export type StoreName = 'postgres' | 'postgres+hybrid' | 'sqlite' | 'sqlite+hybrid'

export interface StoreIndex {
  name: StoreName
  /** Wall time of the sync into the store, embedding included. */
  syncMs: number
  /** The entities the adapter answers with, best first: its top 10. */
  search(query: string): Promise<string[]>
  close(): Promise<void>
}

const STORES: Record<StoreName, { package: string; describe: string }> = {
  postgres: {
    package: '@docket/adapter-postgres',
    describe: 'Postgres through @docket/adapter-postgres: full-text (websearch_to_tsquery, BM25 over title, type and tags, body) with the trigram title lift, top 10, no floor.'
  },
  'postgres+hybrid': {
    package: '@docket/adapter-postgres',
    describe: 'As postgres, fused by reciprocal rank with pgvector cosine similarity of the same embeddings as semantic, top 10, no floor.'
  },
  sqlite: {
    package: '@docket/adapter-sqlite',
    describe: 'SQLite through @docket/adapter-sqlite: FTS5 BM25 with Lucene idf over title, type and tags, body, Porter-stemmed, top 10, no floor.'
  },
  'sqlite+hybrid': {
    package: '@docket/adapter-sqlite',
    describe: 'As sqlite, fused by reciprocal rank with cosine similarity of the same embeddings as semantic, top 10, no floor.'
  }
}

/** The instance id a store's adapter has in the corpus's docket. */
const instanceOf = (name: StoreName): string => name.replace('+', '-')

/**
 * Adds an adapter instance for `name` to the docket in `dir`, syncs it, and
 * opens it for questions. Postgres instances keep each corpus and variant in
 * a scope of its own in the database at `pgUrl`; SQLite ones a file in their
 * own state directory. A hybrid instance embeds with `embedder` through
 * Ollama at `ollamaUrl`. The module is the workspace's built adapter, by
 * absolute path.
 */
export const storeIndex = async (
  dir: string,
  corpus: string,
  name: StoreName,
  options: { pgUrl?: string | undefined; ollamaUrl: string; embedder: string }
): Promise<StoreIndex> => {
  const store = STORES[name]
  const module = join(dirname(createRequire(import.meta.url).resolve(`${store.package}/package.json`)), 'dist', 'index.js')
  const id = instanceOf(name)
  const hybrid = name.endsWith('+hybrid')
  const config = {
    ...(name.startsWith('postgres') ? { url: options.pgUrl, schema: 'docket_eval', scope: `${corpus}-${id}` } : {}),
    ...(hybrid ? { semantic: { url: options.ollamaUrl, model: options.embedder, batchSize: 64, timeoutMs: 300_000 } } : {})
  }
  const file = join(dir, '.docket.yaml')
  const docket = parse(await readFile(file, 'utf8')) as { adapters: unknown[] }
  docket.adapters = [
    ...docket.adapters.filter((adapter) => (adapter as { id?: unknown }).id !== id),
    { id, module, roles: ['projection', 'query'], config }
  ]
  await writeFile(file, stringify(docket))

  const started = performance.now()
  await sync({ cwd: dir, adapters: [id] })
  const syncMs = performance.now() - started

  const opened = await createDocket({ projectRoot: dir })
  const slot = opened.adapters.find((adapter) => adapter.id === id)
  if (!slot) throw new Error(`the ${name} adapter instance did not load`)
  const adapter: MemoryAdapter = await slot.create()
  let asked = 0
  return {
    name,
    syncMs,
    async search(query) {
      const now = new Date()
      asked += 1
      const answer = await adapter.query!.ask({
        requestId: `eval-${asked}`,
        question: query,
        context: { scope: slot.scope, now: now.toISOString(), timezone: 'UTC' },
        budget: { maxResults: ANSWER_LIMIT, maxEvidenceBytes: 10_000_000, deadline: new Date(now.getTime() + 120_000).toISOString() }
      })
      return answer.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((item) => item.ref.id) : []))
    },
    close: () => adapter.close()
  }
}

/** A store's own top 10, however weak: what the adapter answers. */
export const storeStrategy = (index: StoreIndex): Strategy => ({
  name: index.name,
  description: STORES[index.name].describe,
  search: async (query) => ({ ids: (await index.search(query)).slice(0, ANSWER_LIMIT), llmCalls: 0 })
})
