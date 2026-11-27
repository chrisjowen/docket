// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { AdapterAnswer, CanonicalReader, EntityInput } from '@chrisjowen/docket/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openCognee } from './cognee.js'
import { serveFakeCognee, startFakeCognee, type FakeCognee } from './fake-cognee.js'

const scope = 'ws_wsmain'
const entity = (id: string, title: string, content: string, links: EntityInput['links'] = []): EntityInput =>
  ({
    kind: 'entity',
    id,
    revision: `sha256:${id}-1`,
    scope,
    type: id.split('.')[0],
    title,
    path: `.docket/resources/${id}.md`,
    paths: [`.docket/resources/${id}.md`],
    tags: [],
    attributes: {},
    links,
    content,
    mentions: [],
    evidence: [],
    confidence: 0.5,
    basis: 'unevidenced',
    evidenceCount: 0,
    sources: [],
    index: { graph: true, fts: true, vector: true },
  }) as EntityInput

const PEOPLE = [
  entity('team.platform', 'Platform team', 'Runs the shared clusters and the deploy pipeline.'),
  entity('person.hannah', 'Hannah Okoro', 'Hannah Okoro leads the platform team and owns the deploy pipeline.', [{ rel: 'member_of', target: 'team.platform' } as EntityInput['links'][number]]),
  entity('person.tomas', 'Tomás Silva', 'Tomás Silva writes the billing service.'),
]
const reader: CanonicalReader = {
  get: async (kind, id) => PEOPLE.find((person) => person.kind === kind && person.id === id),
  list: async (kind) => PEOPLE.filter((person) => person.kind === kind),
}
const ids = (answer: AdapterAnswer) => answer.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((e) => e.ref.id) : []))
const ask = (question: string) => ({
  requestId: randomUUID(),
  question,
  context: { scope, now: new Date().toISOString(), timezone: 'UTC' },
  budget: { maxResults: 10, maxEvidenceBytes: 64 * 1024, deadline: new Date(Date.now() + 10_000).toISOString() },
})

/**
 * docket's cognee adapter as 0.8.0 bundles it, opened as the cloud opens it,
 * against docket's fake cognee: it files a workspace's entities, and search's
 * floor lets it answer a question about someone the workspace never recorded
 * with nothing, where without one it answers with its nearest chunks.
 */
describe("search's floor on docket's cognee adapter", () => {
  let fake: FakeCognee
  let server: Awaited<ReturnType<typeof serveFakeCognee>>
  const access = () => ({ url: server.url, apiKey: 'test-key' })

  beforeAll(async () => {
    fake = startFakeCognee({ apiKey: 'test-key' })
    server = await serveFakeCognee(fake)
    const adapter = await openCognee({ orgId: 'orgacme', workspaceId: 'wsmain', access: access(), canonical: reader })
    const receipt = await adapter.projection?.apply({ batchId: randomUUID(), scope, checkpoint: 'c1', changes: PEOPLE.map((record) => ({ operation: 'upsert', record })) })
    expect(receipt?.applied.sort()).toEqual(PEOPLE.map((person) => person.id).sort())
    await adapter.close()
  })
  afterAll(() => server?.close())

  it("files each entity in the workspace's dataset, its links named by title", () => {
    const items = [...(fake.datasets.get('docket_org_orgacme__ws_wsmain')?.items.values() ?? [])]
    expect(items.map((item) => item.externalMetadata?.docket_id).sort()).toEqual(['person.hannah', 'person.tomas', 'team.platform'])
    expect(items.find((item) => item.externalMetadata?.docket_id === 'person.hannah')?.text).toContain('member of: Platform team')
  })

  it('answers a question it holds, scored as a similarity', async () => {
    const adapter = await openCognee({ orgId: 'orgacme', workspaceId: 'wsmain', access: access(), canonical: reader, floor: 0.58 })
    const answer = await adapter.query?.ask(ask('who leads the platform team'))
    expect(answer && ids(answer)[0]).toBe('person.hannah')
    const top = answer?.blocks.find((block) => block.kind === 'entities')
    expect(top?.kind === 'entities' && (top.entities[0]?.score ?? 0) >= 0.58).toBe(true)
  })

  it('abstains on someone the workspace never recorded, where cognee without a floor answers with its nearest chunks', async () => {
    const floored = await openCognee({ orgId: 'orgacme', workspaceId: 'wsmain', access: access(), canonical: reader, floor: 0.58 })
    const unfloored = await openCognee({ orgId: 'orgacme', workspaceId: 'wsmain', access: access(), canonical: reader })
    const question = 'who is sophia from billing'
    const without = await unfloored.query?.ask(ask(question))
    expect(without && ids(without).length).toBeGreaterThan(0)
    const withFloor = await floored.query?.ask(ask(question))
    expect(withFloor && ids(withFloor)).toEqual([])
  })
})
