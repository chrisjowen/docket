import { afterEach, describe, expect, it } from 'vitest'

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { INDEX, makeRepo, memory, readJsonl, removeRepo, write } from './helpers.js'
import type { DocumentRecord } from '@docket/adapter-jsonl'

/**
 * Spec §73 states the target is 10-10,000 memory documents on a developer
 * machine, and that "startup scan and sync should be efficient enough for local
 * development". That is a shape, not a number, so this is a smoke check with
 * roughly an order of magnitude of headroom on a laptop - enough to catch an
 * accidental exponential or a per-document process spawn, and nothing tighter.
 * A flaky performance assertion is worse than none.
 *
 * The one hard number is the Claude plugin's: a cold sync that cannot finish
 * inside the 20 s a session-start hook used to allow never saved its manifest,
 * so it restarted from nothing every session and never converged. A cold sync
 * of 2,000 documents takes well under a second on a laptop, so 20 s still
 * leaves an order of magnitude for a slow CI runner.
 */

const DOCUMENTS = 2_000
const COLD_SYNC_BUDGET_MS = 20_000
const WARM_SYNC_BUDGET_MS = 20_000

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
          `.docket/notes/n${i}.md`,
          `---\nid: decision.n${i}\ntype: decision\ntitle: Decision ${i}\n` +
            `links:\n  - rel: supersedes\n    target: decision.n${(i + 1) % DOCUMENTS}\n---\n\nBody ${i}.\n`
        )
      }

      const cold = await elapsed(async () => {
        const result = await memory(repo, 'sync')
        expect(result.stdout).toContain(`${DOCUMENTS} projected`)
      })
      expect(cold).toBeLessThan(COLD_SYNC_BUDGET_MS)
      // A completed pass records what it projected, which is what lets the next
      // one converge instead of starting over.
      expect(existsSync(join(repo, INDEX, 'manifest.json'))).toBe(true)

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
