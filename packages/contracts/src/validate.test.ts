import { describe, expect, it } from 'vitest'

import { sampleBatch, sampleDocument, sampleEntity, sampleObservation } from './testing.js'
import type { AdapterAnswer } from './types.js'
import {
  ContractError,
  unacknowledged,
  validateAdapterAnswer,
  validateAdapterDefinition,
  validateAdapterStatus,
  validateApplyReceipt,
  validateCanonicalInput,
  validateMemoryAdapter
} from './validate.js'

const answer = (overrides: Partial<AdapterAnswer> = {}): AdapterAnswer => ({
  interpretation: { description: 'keyword search', assumptions: [] },
  blocks: [
    {
      kind: 'entities',
      id: 'hits',
      evidenceIds: [],
      entities: [{ ref: { kind: 'entity', id: 'service.orders' }, score: 2 }]
    },
    { kind: 'passages', id: 'passages', evidenceIds: ['e1'] }
  ],
  evidence: [
    {
      id: 'e1',
      kind: 'passage',
      text: 'Takes and fulfils customer orders.',
      canonicalRefs: [{ kind: 'entity', id: 'service.orders', revision: 'sha256:1', span: { path: 'a.md', startLine: 3 } }]
    }
  ],
  coverage: { mode: 'top-k', truncated: false, scope: 'payments' },
  diagnostics: [],
  ...overrides
})

const definition = {
  apiVersion: 1,
  name: 'fake',
  validateConfig: (value: unknown) => value,
  create: async () => ({})
}

describe('validateAdapterDefinition', () => {
  it('accepts a well-formed definition', () => {
    expect(validateAdapterDefinition(definition).name).toBe('fake')
  })

  it('rejects an unsupported contract major before anything else', () => {
    expect(() => validateAdapterDefinition({ apiVersion: 2 }, 'adapter "x"')).toThrow(
      'adapter "x" declares apiVersion 2; this docket supports adapter apiVersion 1'
    )
    expect(() => validateAdapterDefinition({ name: 'old' })).toThrow(/declares no apiVersion/)
  })

  it('names every missing member', () => {
    const attempt = () => validateAdapterDefinition({ apiVersion: 1 })
    expect(attempt).toThrow(ContractError)
    expect(attempt).toThrow(/name must be a non-empty string[\s\S]*validateConfig must be a function[\s\S]*create must be a function/)
  })

  it('rejects a module without an object default export', () => {
    expect(() => validateAdapterDefinition(undefined)).toThrow(/does not export an adapter definition/)
  })
})

describe('validateMemoryAdapter', () => {
  const base = { describe: () => ({}), status: async () => ({}), close: async () => {} }

  it('accepts an adapter with optional ports absent', () => {
    expect(validateMemoryAdapter(base)).toBe(base)
  })

  it('rejects ports missing their methods', () => {
    expect(() => validateMemoryAdapter({ ...base, projection: { apply: async () => ({}) }, query: {} })).toThrow(
      /projection.reset must be a function[\s\S]*query.ask must be a function/
    )
  })
})

describe('validateAdapterStatus', () => {
  it('keeps extension fields but not in place of required ones', () => {
    expect(validateAdapterStatus({ state: 'ready', message: 'ok', vendor: { region: 'eu' } })).toMatchObject({
      vendor: { region: 'eu' }
    })
    expect(() => validateAdapterStatus({ message: 'ok', status: 'ready' })).toThrow(/state/)
  })
})

describe('validateCanonicalInput', () => {
  it('accepts every input kind', () => {
    expect(validateCanonicalInput(sampleEntity()).kind).toBe('entity')
    expect(
      validateCanonicalInput({
        kind: 'observation',
        id: 'obs.1',
        revision: 'r1',
        scope: 's',
        text: 'Deployed orders 1.4',
        sources: [{ path: 'ci.log' }],
        entityRefs: ['service.orders'],
        observedAt: '2026-10-01T00:00:00Z'
      }).kind
    ).toBe('observation')
    expect(
      validateCanonicalInput({
        kind: 'document',
        id: 'doc.1',
        revision: 'r1',
        scope: 's',
        text: 'ADR',
        source: { path: 'adr.md', startLine: 1, endLine: 4 },
        entityRefs: []
      }).kind
    ).toBe('document')
  })

  it('takes an observation without an observed time, and with its provenance', () => {
    const { observedAt: _unknown, ...unseen } = sampleObservation()
    expect(validateCanonicalInput(unseen)).not.toHaveProperty('observedAt')
    expect(validateCanonicalInput(sampleObservation())).toMatchObject({ recordedIn: ['.docket/resources/services/orders.md'] })
    expect(validateCanonicalInput(sampleDocument())).toMatchObject({ source: { startLine: 6, endLine: 7 } })
    expect(() => validateCanonicalInput(sampleObservation({ observedAt: '' }))).toThrow(/observedAt/)
    expect(() =>
      validateCanonicalInput(sampleObservation({ relationship: { source: 'service.orders', rel: '', target: 'x' } }))
    ).toThrow(/relationship\.rel/)
  })
})

describe('validateApplyReceipt', () => {
  const batch = sampleBatch()

  it('checks the receipt answers the batch it was given', () => {
    expect(() => validateApplyReceipt({ batchId: 'other', applied: [], failed: [] }, batch)).toThrow(
      /batchId is "other"/
    )
    expect(() => validateApplyReceipt({ batchId: batch.batchId, applied: ['nope'], failed: [] }, batch)).toThrow(
      /"nope" is not a change in the batch/
    )
    expect(() =>
      validateApplyReceipt(
        { batchId: batch.batchId, applied: ['service.orders'], failed: [{ id: 'service.orders', retryable: true, message: 'x' }] },
        batch
      )
    ).toThrow(/both applied and failed/)
  })

  it('reports changes left unacknowledged', () => {
    const receipt = validateApplyReceipt({ batchId: batch.batchId, applied: ['service.orders'], failed: [] }, batch)
    expect(unacknowledged(batch, receipt)).toEqual(['service.retired'])
  })
})

describe('validateAdapterAnswer', () => {
  it('accepts a well-formed answer and checks its scope against the request', () => {
    expect(validateAdapterAnswer(answer()).blocks).toHaveLength(2)
    expect(() => validateAdapterAnswer(answer(), { context: { scope: 'other', now: '', timezone: 'UTC' } })).toThrow(
      /asked in scope "other"/
    )
  })

  it('rejects references to evidence the answer does not carry', () => {
    expect(() => validateAdapterAnswer(answer({ evidence: [] }))).toThrow(/blocks.1.evidenceIds.0: no evidence has id "e1"/)
  })

  it('rejects unknown block kinds and passage blocks without evidence', () => {
    expect(() => validateAdapterAnswer(answer({ blocks: [{ kind: 'chart', id: 'c', evidenceIds: [] } as never] }))).toThrow(
      ContractError
    )
    expect(() => validateAdapterAnswer(answer({ blocks: [{ kind: 'facts', id: 'f', evidenceIds: [] }] }))).toThrow(
      /evidenceIds/
    )
  })

  it('rejects values that are not plain JSON', () => {
    const withDate = answer()
    ;(withDate.interpretation as Record<string, unknown>).extra = new Date()
    expect(() => validateAdapterAnswer(withDate)).toThrow(/plain JSON: interpretation.extra is a Date/)

    const withBigInt = answer()
    ;(withBigInt as unknown as Record<string, unknown>).count = 10n
    expect(() => validateAdapterAnswer(withBigInt)).toThrow(/count is a BigInt/)
  })

  it('requires a revision for any source span', () => {
    const bad = answer()
    bad.evidence[0]!.canonicalRefs = [{ kind: 'entity', id: 'x', span: { path: 'a.md' } }]
    expect(() => validateAdapterAnswer(bad)).toThrow(/needs the revision/)
  })

  it('checks graph edges and paths stay within the nodes', () => {
    const graph = answer({
      blocks: [
        {
          kind: 'graph',
          id: 'g',
          evidenceIds: [],
          nodes: [{ id: 'a', label: 'A' }],
          edges: [{ source: 'a', target: 'b', rel: 'depends_on' }],
          paths: [['a', 'c']]
        }
      ]
    })
    expect(() => validateAdapterAnswer(graph)).toThrow(/edge end "b" is not a node[\s\S]*path node "c" is not a node/)
  })

  it('types table cells by column, keeping large counts as decimal strings', () => {
    const table = (cells: Record<string, unknown>) =>
      answer({
        blocks: [
          {
            kind: 'table',
            id: 't',
            evidenceIds: [],
            columns: [
              { key: 'service', label: 'Service', type: 'reference' },
              { key: 'count', label: 'Deployments', type: 'integer' },
              { key: 'bytes', label: 'Bytes', type: 'decimal' }
            ],
            rows: [{ cells: cells as never, evidenceIds: ['e1'] }]
          }
        ]
      })

    expect(() =>
      validateAdapterAnswer(table({ service: { kind: 'entity', id: 'service.orders' }, count: 12, bytes: '9007199254740993' }))
    ).not.toThrow()
    expect(() => validateAdapterAnswer(table({ count: 9007199254740993 }))).toThrow(/use a decimal column/)
    expect(() => validateAdapterAnswer(table({ bytes: 12 }))).toThrow(/decimal cell must be a string of digits/)
    expect(() => validateAdapterAnswer(table({ owner: 'x' }))).toThrow(/column "owner" is not declared/)
  })

  it('accepts metric and timeline blocks', () => {
    expect(() =>
      validateAdapterAnswer(
        answer({
          blocks: [
            { kind: 'metric', id: 'm', evidenceIds: ['e1'], label: 'Deployments', value: 4, unit: 'count' },
            {
              kind: 'timeline',
              id: 'tl',
              evidenceIds: [],
              events: [{ label: 'Deployed', at: '2026-10-01T10:00:00Z', semantics: 'event', evidenceIds: ['e1'] }]
            }
          ]
        })
      )
    ).not.toThrow()
    expect(() =>
      validateAdapterAnswer(answer({ blocks: [{ kind: 'metric', id: 'm', evidenceIds: [], label: 'x', value: '4' as never }] }))
    ).toThrow(ContractError)
  })
})
