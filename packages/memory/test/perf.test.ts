import { afterEach, describe, expect, it } from 'vitest'

import { makeRepo, memory, readJsonl, removeRepo, write } from './helpers.js'
import type { DocumentRecord } from '../src/projection/jsonl/jsonl-projection.js'

/**
 * Spec §73 states the target is 10-10,000 memory documents on a developer
 * machine, and that "startup scan and sync should be efficient enough for local
 * development". That is a shape, not a number, so this is a smoke check with
 * roughly an order of magnitude of headroom on a laptop - enough to catch an
 * accidental exponential or a per-document process spawn, and nothing tighter.
 * A flaky performance assertion is worse than none.
 */

const DOCUMENTS = 500
const COLD_SYNC_BUDGET_MS = 90_000
const WARM_SYNC_BUDGET_MS = 30_000

let root: string | undefined

afterEach(async () => {
  await removeRepo(root)
  root = undefined
})

const elapsed = async (work: () => Promise<unknown>): Promise<number> => {
  const started = Date.now()
  await work()
  return Date.now() - started
}

describe('performance expectations (spec §73)', () => {
  it(
    `syncs ${DOCUMENTS} documents and then re-syncs them without reprojecting`,
    async () => {
      root = await makeRepo('memory-perf')
      const repo = root

      for (let i = 0; i < DOCUMENTS; i += 1) {
        await write(
          repo,
          `.memory/notes/n${i}.md`,
          `---\nid: decision.n${i}\ntype: decision\ntitle: Decision ${i}\n` +
            `links:\n  - rel: supersedes\n    target: decision.n${(i + 1) % DOCUMENTS}\n---\n\nBody ${i}.\n`
        )
      }

      const cold = await elapsed(async () => {
        const result = await memory(repo, 'sync')
        expect(result.stdout).toContain(`${DOCUMENTS} projected`)
      })
      expect(cold).toBeLessThan(COLD_SYNC_BUDGET_MS)

      expect(await readJsonl<DocumentRecord>(repo, 'documents.jsonl')).toHaveLength(
        DOCUMENTS
      )

      // The path a developer actually hits repeatedly: nothing changed, so the
      // manifest hash gate should make the pass cheap (spec §24, §38).
      const warm = await elapsed(async () => {
        const result = await memory(repo, 'sync')
        expect(result.stdout).toContain(`0 projected, 0 removed, ${DOCUMENTS} unchanged`)
      })
      expect(warm).toBeLessThan(WARM_SYNC_BUDGET_MS)
    },
    180_000
  )
})
