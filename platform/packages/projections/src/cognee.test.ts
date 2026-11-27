// SPDX-License-Identifier: AGPL-3.0-only
import type { AdapterAnswer, AdapterDefinition, AdapterServices, MemoryAdapter } from '@chrisjowen/docket/contracts'
import { describe, expect, it } from 'vitest'

import { ADAPTER_VERSION } from './adapters.js'
import { CogneeUnavailable, cogneeDataset, cogneeFingerprint, floorAnswer, loadCogneeAdapter, maxDistanceOf, openCognee } from './cognee.js'

/** What docket's cognee adapter answers: chunk passages and their entities, scored as cosine distances. */
const answer = (hits: { id: string; distance: number }[]): AdapterAnswer => ({
  interpretation: { description: 'cognee chunk search', assumptions: ["Scores are cognee's cosine distances - lower is closer."], nativeQuery: 'q' },
  blocks: [
    { kind: 'passages', id: 'passages', evidenceIds: hits.map((hit) => `p-${hit.id}`) },
    { kind: 'entities', id: 'entities', evidenceIds: hits.map((hit) => `p-${hit.id}`), entities: hits.map((hit) => ({ ref: { kind: 'entity', id: hit.id }, score: hit.distance })) },
  ],
  evidence: hits.map((hit) => ({ id: `p-${hit.id}`, kind: 'passage', text: hit.id, canonicalRefs: [{ kind: 'entity', id: hit.id }], score: hit.distance })),
  coverage: { mode: 'top-k', truncated: false, scope: 'ws_wsmain' },
  diagnostics: [],
})

const ids = (reply: AdapterAnswer) => reply.blocks.flatMap((block) => (block.kind === 'entities' ? block.entities.map((entity) => entity.ref.id) : []))

describe('the score floor on what cognee answers', () => {
  it('keeps chunks at least as similar as the floor, scored as that similarity', () => {
    const floored = floorAnswer(answer([{ id: 'team.payments', distance: 0.2 }, { id: 'service.orders', distance: 0.5 }]), 0.58)
    expect(ids(floored)).toEqual(['team.payments'])
    expect(floored.blocks.find((block) => block.kind === 'entities')).toMatchObject({ entities: [{ score: 0.8 }] })
    expect(floored.evidence).toEqual([expect.objectContaining({ id: 'p-team.payments', score: 0.8 })])
    expect(floored.diagnostics).toEqual([expect.objectContaining({ code: 'cognee-floor' })])
    expect(floored.interpretation.assumptions.join(' ')).toContain('at least 0.58 similar')
  })

  it('abstains, answering with nothing, when every chunk is under the floor', () => {
    const floored = floorAnswer(answer([{ id: 'person.hannah', distance: 0.61 }, { id: 'person.tomas', distance: 0.7 }]), 0.58)
    expect(floored.blocks).toEqual([])
    expect(floored.evidence).toEqual([])
  })

  it('cuts at the distance the adapter is asked for', () => {
    expect(maxDistanceOf(0.58)).toBe(0.42)
    expect(floorAnswer(answer([{ id: 'edge', distance: 0.42 }]), 0.58).evidence).toHaveLength(1)
  })
})

describe('openCognee', () => {
  const definition = (seen: { config?: unknown; services?: AdapterServices }, reply: AdapterAnswer): AdapterDefinition<unknown> => ({
    apiVersion: 1,
    name: 'cognee',
    validateConfig: (input) => input,
    create: async (config, services) => {
      seen.config = config
      seen.services = services
      return {
        describe: () => ({ name: 'cognee', version: 'test', inputs: ['entity'], resultKinds: ['passages', 'entities'], rebuild: 'reconstructible' }),
        status: async () => ({ state: 'ready', message: 'ok' }),
        query: { ask: async () => reply },
        close: async () => undefined,
      } as unknown as MemoryAdapter
    },
  })
  const canonical = { get: async () => undefined, list: async () => [] }
  const access = { url: 'http://docket-cognee:8000', apiKey: 'secret-key-value' }

  it("files into the workspace's own dataset, entities only, with the service's key for this instance alone", async () => {
    const seen: { config?: unknown; services?: AdapterServices } = {}
    await openCognee({ orgId: 'orgacme', workspaceId: 'wsmain', access, canonical, load: async () => definition(seen, answer([])) })
    expect(seen.config).toEqual({ url: access.url, apiKeyEnv: 'DOCKET_COGNEE_API_KEY', dataset: 'docket_org_orgacme__ws_wsmain', inputs: ['entity'] })
    expect(seen.services?.scope).toBe('ws_wsmain')
    expect(seen.services?.canonical).toBe(canonical)
    expect(await seen.services?.secrets.getEnv('DOCKET_COGNEE_API_KEY')).toBe('secret-key-value')
    expect(await seen.services?.secrets.getEnv('OPENROUTER_API_KEY')).toBeUndefined()
    expect(process.env.DOCKET_COGNEE_API_KEY).toBeUndefined()
  })

  it('asks with the floor on search, and holds what comes back to it', async () => {
    const seen: { config?: unknown } = {}
    const adapter = await openCognee({
      orgId: 'orgacme',
      workspaceId: 'wsmain',
      access,
      canonical,
      floor: 0.58,
      load: async () => definition(seen, answer([{ id: 'person.hannah', distance: 0.7 }])),
    })
    expect(seen.config).toMatchObject({ maxDistance: 0.42 })
    const reply = await adapter.query?.ask({ requestId: 'r', question: 'who is sophia', context: { scope: 'ws_wsmain', now: '', timezone: 'UTC' }, budget: { maxResults: 10, maxEvidenceBytes: 1, deadline: '' } })
    expect(reply && ids(reply)).toEqual([])
  })

  it('names one dataset per workspace and vouches for a manifest only on the same service and dataset', () => {
    expect(cogneeDataset('orgacme', 'wsmain')).not.toBe(cogneeDataset('orgacme', 'wsother'))
    expect(cogneeDataset('orgacme', 'wsmain')).toMatch(/^[^.\s]+$/)
    expect(cogneeFingerprint('orgacme', 'wsmain', access)).toBe(cogneeFingerprint('orgacme', 'wsmain', { url: access.url }))
    expect(cogneeFingerprint('orgacme', 'wsmain', access)).not.toBe(cogneeFingerprint('orgacme', 'wsmain', { url: 'http://elsewhere:8000' }))
  })

  it("loads docket's cognee adapter from the docket release, or refuses naming the release that lacks it", async () => {
    const bundled = Number(ADAPTER_VERSION.split('.')[1]) >= 8 || Number(ADAPTER_VERSION.split('.')[0]) >= 1
    if (bundled) expect((await loadCogneeAdapter()).name).toBe('cognee')
    else await expect(loadCogneeAdapter()).rejects.toThrow(new CogneeUnavailable(`cognee is not available: @chrisjowen/docket ${ADAPTER_VERSION} does not bundle docket's cognee adapter`))
  })
})
