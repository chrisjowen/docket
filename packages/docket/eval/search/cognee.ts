import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { MemoryAdapter } from '@docket/contracts'
import { parse, stringify } from 'yaml'

import { createDocket } from '../../src/adapters/docket.js'
import { sync } from '../../src/commands/sync.js'
import type { Scored } from './engine.js'
import { ANSWER_LIMIT, SOURCE_LIMIT, type FloorParams, type Strategy } from './strategies.js'

/*
 * cognee as a projector (README.md): a corpus's docket synced into a cognee
 * server through @docket/adapter-cognee - added, cognified - and each query
 * answered with the adapter's own ask, which runs cognee's CHUNKS search.
 * Only the adapter's answer is read: the entities it names, best first, each
 * with its closest chunk's cosine similarity (1 - cognee's distance).
 */

/** The variable the adapter reads the eval server's API key from, when it needs one. */
export const COGNEE_KEY_ENV = 'DOCKET_EVAL_COGNEE_API_KEY'

export interface CogneeIndex {
  /** Wall time of the sync into cognee, cognify included. */
  syncMs: number
  /** Entities, best first, with their closest chunk's cosine similarity. Twice the answer limit, for the floor. */
  search(query: string): Promise<Scored[]>
  close(): Promise<void>
}

/**
 * Adds a cognee adapter instance to the docket in `dir` - dataset
 * `docket-eval-<corpus>` on the server at `url` - syncs it, and opens it for
 * questions. The module is the workspace's built adapter, by absolute path.
 */
export const cogneeIndex = async (dir: string, corpus: string, url: string): Promise<CogneeIndex> => {
  const module = join(dirname(createRequire(import.meta.url).resolve('@docket/adapter-cognee/package.json')), 'dist', 'index.js')
  const file = join(dir, '.docket.yaml')
  const config = parse(await readFile(file, 'utf8')) as { adapters: unknown[] }
  config.adapters = [
    ...config.adapters.filter((adapter) => (adapter as { id?: unknown }).id !== 'cognee'),
    {
      id: 'cognee',
      module,
      roles: ['projection', 'query'],
      config: { url, apiKeyEnv: COGNEE_KEY_ENV, dataset: `docket-eval-${corpus}`, timeoutMs: 120_000 }
    }
  ]
  await writeFile(file, stringify(config))

  const started = performance.now()
  await sync({ cwd: dir, adapters: ['cognee'] })
  const syncMs = performance.now() - started

  const docket = await createDocket({ projectRoot: dir })
  const slot = docket.adapters.find((adapter) => adapter.id === 'cognee')
  if (!slot) throw new Error('the cognee adapter instance did not load')
  const adapter: MemoryAdapter = await slot.create()
  let asked = 0
  return {
    syncMs,
    async search(query) {
      const now = new Date()
      asked += 1
      const answer = await adapter.query!.ask({
        requestId: `eval-${asked}`,
        question: query,
        context: { scope: slot.scope, now: now.toISOString(), timezone: 'UTC' },
        budget: { maxResults: 2 * SOURCE_LIMIT, maxEvidenceBytes: 10_000_000, deadline: new Date(now.getTime() + 120_000).toISOString() }
      })
      return answer.blocks.flatMap((block) =>
        block.kind === 'entities' ? block.entities.map((item) => ({ id: item.ref.id, score: item.score === undefined ? 0 : 1 - item.score })) : []
      )
    },
    close: () => adapter.close()
  }
}

/** cognee's own top 10, however far: what the adapter answers with no `maxDistance`. */
export const cogneeStrategy = (index: CogneeIndex): Strategy => ({
  name: 'cognee',
  description: 'cognee 1.6.8 through @docket/adapter-cognee: its CHUNKS search over cognified entities, top 10, no floor.',
  search: async (query) => ({ ids: (await index.search(query)).slice(0, ANSWER_LIMIT).map((hit) => hit.id), llmCalls: 0 })
})

/** The entities at or above the floor's cosine similarity, top 10. */
export const cogneeFloored = (hits: readonly Scored[], floor: Pick<FloorParams, 'semantic'>): string[] =>
  hits.filter((hit) => hit.score >= floor.semantic).slice(0, ANSWER_LIMIT).map((hit) => hit.id)

/** cognee with a relevance floor: the adapter's `maxDistance: 1 - floor`. */
export const cogneeFloorStrategy = (index: CogneeIndex, floor: Pick<FloorParams, 'semantic'>): Strategy => ({
  name: 'cognee+floor',
  description: `As cognee, keeping chunks with cosine similarity >= ${floor.semantic} - the adapter's maxDistance: ${Math.round((1 - floor.semantic) * 100) / 100}.`,
  search: async (query) => ({ ids: cogneeFloored(await index.search(query), floor), llmCalls: 0 })
})
