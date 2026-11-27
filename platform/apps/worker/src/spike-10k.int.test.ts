// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryAdapter } from '@chrisjowen/docket/contracts'
import { putDocument } from '@docket/platform-canonical-store'
import { openProjections } from '@docket/platform-projections'
import { qdrantProvisioner } from '@docket/platform-provisioner'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHarness, HAVE_STACK, type Harness } from './testing.js'

/**
 * The M4 spike (docs/spikes/neo4j-per-org.md): a 10,000-document workspace
 * rebuilt into Neo4j Community at the spec's memory floor, and into mem0 with
 * the real in-cluster embedder. Off by default; run with
 *
 *   DOCKET_SPIKE_10K=1 [DOCKET_SPIKE_EMBEDDER_URL=http://127.0.0.1:11434] pnpm --filter @docket/server-worker exec vitest run src/spike-10k.int.test.ts
 */
const RUN = HAVE_STACK && process.env.DOCKET_SPIKE_10K === '1'
const EMBEDDER = process.env.DOCKET_SPIKE_EMBEDDER_URL
const COUNTS = { team: 200, service: 3_000, datasource: 3_000, api: 2_000, pod: 1_800 }

const body = (id: string) =>
  `${id} is part of the synthetic platform the spike measures. It has an owner, a runbook and a dashboard; ` +
  `on-call rotates weekly. Changes go through review and a staged rollout. `.repeat(4)

function document(type: string, index: number): { path: string; raw: string } {
  const id = `${type}.${type}-${index}`
  const links: string[] = [`  - { rel: owned_by, target: team.team-${index % COUNTS.team} }`]
  if (type === 'service') {
    links.push(`  - { rel: depends_on, target: datasource.datasource-${index % COUNTS.datasource} }`)
    links.push(`  - { rel: depends_on, target: datasource.datasource-${(index * 7) % COUNTS.datasource} }`)
    if (index > 0) links.push(`  - { rel: depends_on, target: service.service-${(index * 13) % index} }`)
    links.push(`  - { rel: exposes, target: api.api-${index % COUNTS.api} }`)
  }
  const raw = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: ${type} ${index}`,
    ...(type === 'team' ? [] : ['links:', ...links]),
    'evidence:',
    `  - { source: human, observedBy: spike, observedAt: 2026-11-03, note: generated }`,
    '---',
    body(id),
  ].join('\n')
  return { path: `.docket/resources/${type}/${type}-${index}.md`, raw }
}

const rss = async () => Math.round(process.memoryUsage().rss / 1024 / 1024)

describe.skipIf(!RUN)('spike: a 10k-document workspace', () => {
  let h: Harness
  const report: Record<string, unknown> = {}

  beforeAll(async () => {
    h = await createHarness()
    const started = performance.now()
    const all = Object.entries(COUNTS).flatMap(([type, count]) => Array.from({ length: count }, (_, i) => document(type, i)))
    for (let i = 0; i < all.length; i += 500) {
      await h.org.withOrg(async (ctx) => {
        for (const doc of all.slice(i, i + 500)) {
          await putDocument(ctx, { workspaceId: h.workspaceId, ...doc, origin: 'cloud', actor: 'system:spike' })
        }
      })
    }
    report.documents = all.length
    report.writeSeconds = Math.round((performance.now() - started) / 100) / 10
  }, 30 * 60_000)

  afterAll(async () => {
    console.log(`SPIKE ${JSON.stringify(report)}`)
    await h?.close()
  })

  it('rebuilds Neo4j at 256 MB heap and 256 MB page cache', async () => {
    const neo4jOnly = h.reconciler({
      open: async (instance, options) => {
        if (instance === 'mem0') throw new Error('mem0 measured separately')
        return (await openProjections({ ...options, only: ['neo4j'] })).neo4j as MemoryAdapter
      },
    })
    const started = performance.now()
    const result = await neo4jOnly.reconcile(h.org.orgId, h.workspaceId, { fresh: true })
    report.neo4jRebuildSeconds = Math.round((performance.now() - started) / 100) / 10
    report.neo4jApplied = result.instances.find((i) => i.id === 'neo4j')?.applied
    report.workerRssMb = await rss()
    expect((await h.nodes()).count).toBe(10_000)

    // One document changed: the incremental pass a normal write triggers.
    await h.write('.docket/resources/service/service-1.md', document('service', 1).raw.replace('title: service 1', 'title: service one'))
    const incremental = performance.now()
    await neo4jOnly.reconcile(h.org.orgId, h.workspaceId)
    report.neo4jIncrementalMs = Math.round(performance.now() - incremental)
  }, 30 * 60_000)

  it.skipIf(!EMBEDDER)('rebuilds mem0 with nomic-embed-text through Ollama', async () => {
    const qdrant = qdrantProvisioner({ url: h.access.qdrant.url, apiKey: process.env.DOCKET_TEST_QDRANT_API_KEY ?? '', dimension: 768 })
    const orgId = `spike${h.org.orgId.slice(0, 6)}`
    await qdrant.provision({ orgId })
    const access = { ...h.access, qdrant: await qdrant.access({ orgId }, 3_600), embedder: { url: EMBEDDER ?? '', model: 'nomic-embed-text', dimension: 768 } }
    const mem0Only = h.reconciler({
      storeAccess: async () => access,
      open: async (instance, options) => {
        if (instance === 'neo4j') throw new Error('neo4j measured separately')
        return (await openProjections({ ...options, only: ['mem0'] })).mem0 as MemoryAdapter
      },
    })
    const started = performance.now()
    const result = await mem0Only.reconcile(h.org.orgId, h.workspaceId, { fresh: true })
    report.mem0RebuildSeconds = Math.round((performance.now() - started) / 100) / 10
    report.mem0Applied = result.instances.find((i) => i.id === 'mem0')?.applied
    await qdrant.deprovision({ orgId }, 'shred')
  }, 60 * 60_000)
})
