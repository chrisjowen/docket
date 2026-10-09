import { validateAdapterAnswer } from '@docket/contracts'
import { assertAdapterContract, fakeServices, sampleAskRequest } from '@docket/contracts/testing'
import { describe, expect, it, vi } from 'vitest'

import { entityProjectionDefinition, searchAnswer, type EntityProjection } from './entity-projection.js'

const definitionFor = (projection: EntityProjection) =>
  entityProjectionDefinition<{ label: string }>({
    name: projection.name,
    version: '1.2.3',
    rebuild: 'deterministic',
    validateConfig: (input) => {
      const label = (input as { label?: unknown } | undefined)?.label
      if (typeof label !== 'string') throw new Error('label is required')
      return { label }
    },
    createProjection: () => projection
  })

describe('entity projection definitions', () => {
  it('hold the adapter contract, answering a search with one entities block', async () => {
    const ids = new Set<string>()
    const projection: EntityProjection = {
      name: 'memory',
      upsert: async (entity) => void ids.add(entity.id),
      remove: async (id) => void ids.delete(id),
      reset: async () => ids.clear(),
      search: async (_query, limit) => ({ hits: [...ids].slice(0, limit).map((id) => ({ id, score: 1 })), note: 'all of it' })
    }
    const report = await assertAdapterContract(definitionFor(projection), {
      config: { label: 'memory' },
      invalidConfig: {}
    })
    expect(report.checks.every((check) => check.ok)).toBe(true)
  })

  it('initialise the projection against the project and report the package version', async () => {
    const init = vi.fn(async () => {})
    const adapter = await definitionFor({ name: 'probe', init, upsert: async () => {}, remove: async () => {} }).create(
      { label: 'probe' },
      fakeServices({ projectRoot: '/repo' })
    )
    expect(init).toHaveBeenCalledWith({ projectRoot: '/repo' })
    expect(adapter.describe()).toEqual({ name: 'probe', version: '1.2.3', inputs: ['entity'], resultKinds: [], rebuild: 'deterministic' })
    expect(adapter.query).toBeUndefined()
  })

  it('close a projection whose init fails and rethrow its error', async () => {
    const close = vi.fn(async () => {})
    const projection: EntityProjection = {
      name: 'neo4j',
      init: async () => {
        throw new Error('no schema privileges')
      },
      upsert: async () => {},
      remove: async () => {},
      close
    }
    await expect(definitionFor(projection).create({ label: 'x' }, fakeServices({ projectRoot: '/repo' }))).rejects.toThrow(
      'no schema privileges'
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('searchAnswer', () => {
  const request = (maxResults = 10, maxEvidenceBytes = 10_000) => {
    const sample = sampleAskRequest()
    return { ...sample, budget: { ...sample.budget, maxResults, maxEvidenceBytes } }
  }

  it('shows each hit as an entity, with its revision, and its passage as evidence', () => {
    const answer = searchAnswer(
      {
        hits: [
          { id: 'service.orders', score: 2.5, revision: 'sha256:1', passage: { text: 'Takes orders.', nativeId: 'm-1' }, detail: 'owned_by → team.payments' },
          { id: 'team.payments', score: 1 }
        ],
        note: 'keyword search'
      },
      request()
    )
    expect(validateAdapterAnswer(answer)).toEqual(answer)
    expect(answer.blocks).toEqual([
      {
        kind: 'entities',
        id: 'hits',
        evidenceIds: ['passage-1'],
        entities: [
          { ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:1' }, score: 2.5, detail: 'owned_by → team.payments' },
          { ref: { kind: 'entity', id: 'team.payments' }, score: 1 }
        ]
      },
      { kind: 'passages', id: 'passages', evidenceIds: ['passage-1'] }
    ])
    expect(answer.evidence).toEqual([
      {
        id: 'passage-1',
        nativeId: 'm-1',
        kind: 'passage',
        text: 'Takes orders.',
        canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: 'sha256:1' }],
        score: 2.5
      }
    ])
    expect(answer.interpretation.description).toBe('keyword search')
    expect(answer.coverage).toEqual({ mode: 'top-k', truncated: false, scope: request().context.scope })
  })

  it('keeps within the result and evidence budgets, and says it was cut', () => {
    const hits = ['a', 'b', 'c'].map((id) => ({ id, passage: { text: `${id} `.repeat(10) } }))
    const answer = searchAnswer({ hits }, request(2, 25))
    expect(answer.blocks[0]).toMatchObject({ kind: 'entities', entities: [{ ref: { id: 'a' } }, { ref: { id: 'b' } }] })
    expect(answer.evidence.map((item) => item.text)).toEqual(['a '.repeat(10)])
    expect(answer.coverage.truncated).toBe(true)
  })

  it('gives no blocks when nothing matched', () => {
    expect(searchAnswer({ hits: [] }, request()).blocks).toEqual([])
  })
})

describe('projections that answer in full', () => {
  it('answer through their own answer, declaring its result kinds', async () => {
    const projection: EntityProjection = {
      name: 'counts',
      resultKinds: ['metric'],
      upsert: async () => {},
      remove: async () => {},
      answer: async (request) => ({
        interpretation: { description: 'counted', assumptions: [] },
        blocks: [{ kind: 'metric', id: 'count', label: 'services', value: 3, evidenceIds: [] }],
        evidence: [],
        coverage: { mode: 'exhaustive', truncated: false, scope: request.context.scope },
        diagnostics: []
      })
    }
    const report = await assertAdapterContract(definitionFor(projection), { config: { label: 'counts' } })
    expect(report.ok).toBe(true)
    const adapter = await definitionFor(projection).create({ label: 'counts' }, fakeServices())
    expect(adapter.describe().resultKinds).toEqual(['metric'])
    expect((await adapter.query?.ask(sampleAskRequest({ context: { ...sampleAskRequest().context, scope: 'contract-test' } })))?.blocks).toEqual([
      { kind: 'metric', id: 'count', label: 'services', value: 3, evidenceIds: [] }
    ])
  })
})
