// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { EntityInput } from '@chrisjowen/docket/contracts'
import { qdrantProvisioner } from '@docket/platform-provisioner'
import { workspaceScope } from '@docket/platform-tenancy'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeAll, openProjections, type StoreAccess } from './adapters.js'
import { searchWorkspace } from './search.js'
import { HAVE_TEST_STORES, TEST_STORES, startFakeEmbedder } from './testing.js'

const entity = (id: string, title: string, content: string, scope: string): EntityInput => ({
  kind: 'entity',
  id,
  revision: `sha256:${id}-1`,
  scope,
  type: 'service',
  title,
  path: `.docket/resources/service/${id}.md`,
  paths: [`.docket/resources/service/${id}.md`],
  tags: [],
  attributes: {},
  links: [],
  content,
  mentions: [],
  evidence: [],
  confidence: 0.5,
  basis: 'unevidenced',
  evidenceCount: 0,
  sources: [],
  index: { graph: true, fts: true, vector: true },
})

describe.skipIf(!HAVE_TEST_STORES)('openProjections', () => {
  const orgId = `p${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const workspaceId = `w${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const scope = workspaceScope(workspaceId)
  let embedder: Awaited<ReturnType<typeof startFakeEmbedder>>
  let access: StoreAccess
  const qdrant = qdrantProvisioner({ url: TEST_STORES.qdrantUrl ?? '', apiKey: TEST_STORES.qdrantApiKey, dimension: 32 })

  beforeAll(async () => {
    embedder = await startFakeEmbedder()
    await qdrant.provision({ orgId })
    access = {
      neo4j: { url: TEST_STORES.neo4jUrl ?? '', username: 'neo4j', password: TEST_STORES.neo4jPassword },
      qdrant: await qdrant.access({ orgId }, 600),
      embedder,
    }
  })
  afterAll(async () => {
    await qdrant.deprovision({ orgId }, 'shred')
    await embedder?.close()
  })

  it('projects entities into Neo4j and mem0 in the workspace scope, and searches them without a model', async () => {
    const adapters = await openProjections({ orgId, workspaceId, access })
    try {
      for (const adapter of Object.values(adapters)) {
        const receipt = await adapter.projection?.apply({
          batchId: randomUUID(),
          scope,
          checkpoint: 'c1',
          changes: [
            { operation: 'upsert', record: entity('service.orders', 'Orders', 'Takes orders and stores them in Postgres.', scope) },
            { operation: 'upsert', record: entity('service.search', 'Search', 'Full text product search over the catalogue.', scope) },
          ],
        })
        expect(receipt?.applied).toEqual(['service.orders', 'service.search'])
      }
    } finally {
      await closeAll(adapters)
    }
    const outcomes = await searchWorkspace({ orgId, workspaceId, access, question: 'orders postgres' })
    for (const outcome of outcomes) {
      expect(outcome.error).toBeUndefined()
      const ids = outcome.answer?.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((e) => e.ref.id) : []))
      expect(ids?.[0]).toBe('service.orders')
    }
    const cleanup = await openProjections({ orgId, workspaceId, access })
    try {
      for (const adapter of Object.values(cleanup)) await adapter.projection?.reset(scope)
    } finally {
      await closeAll(cleanup)
    }
  }, 60_000)
})
