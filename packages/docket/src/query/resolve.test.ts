import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateAdapterAnswer, type AdapterAnswer } from '@docket/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { init } from '../commands/init.js'
import { resolveReferences } from './evidence.js'
import { checkAnswer, checkReference, foundReferences } from './resolve.js'
import { takeSnapshot, type RequestSnapshot } from './snapshot.js'

const ORDERS = `---
id: service.orders
type: service
title: Orders API
links:
  - rel: owned_by
    target: team.payments
evidence:
  - source: code
    path: src/orders/handler.ts
    lines: 40-88
---

Handles orders for checkout.
Stores them in Postgres.
`

const PAYMENTS = `---
id: team.payments
type: team
title: Payments
---

The payments team owns checkout money movement.
`

let root: string
let snapshot: RequestSnapshot

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-resolve-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources'), { recursive: true })
  await writeFile(join(root, '.docket/resources/orders.md'), ORDERS, 'utf8')
  await writeFile(join(root, '.docket/resources/payments.md'), PAYMENTS, 'utf8')
  snapshot = await takeSnapshot(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const revisionOf = (kind: 'entity' | 'document', id: string): string => snapshot.record(kind, id)?.input.revision ?? 'missing'

describe('checkReference', () => {
  it('resolves a record the files hold in scope, at its revision and within its span', () => {
    expect(checkReference({ kind: 'entity', id: 'service.orders' }, snapshot)).toBe('resolved')
    expect(checkReference({ kind: 'entity', id: 'service.orders', revision: revisionOf('entity', 'service.orders') }, snapshot)).toBe('resolved')
    const document = snapshot.record('document', '.docket/resources/orders.md')?.input
    expect(document?.kind).toBe('document')
    expect(
      checkReference(
        { kind: 'document', id: '.docket/resources/orders.md', revision: document?.revision, span: { path: '.docket/resources/orders.md', startLine: 15, endLine: 15 } },
        snapshot
      )
    ).toBe('resolved')
  })

  it('calls an older revision stale, a record not held unresolved, and a span outside the record unresolved', () => {
    expect(checkReference({ kind: 'entity', id: 'service.orders', revision: 'sha256:old' }, snapshot)).toBe('stale')
    expect(checkReference({ kind: 'entity', id: 'service.ghost' }, snapshot)).toBe('unresolved')
    expect(
      checkReference({ kind: 'entity', id: 'service.orders', revision: revisionOf('entity', 'service.orders'), span: { path: 'elsewhere.md' } }, snapshot)
    ).toBe('unresolved')
    expect(
      checkReference(
        { kind: 'document', id: '.docket/resources/orders.md', revision: revisionOf('document', '.docket/resources/orders.md'), span: { path: '.docket/resources/orders.md', startLine: 1, endLine: 3 } },
        snapshot
      )
    ).toBe('unresolved')
  })

  it('calls a reference that says it belongs to another scope foreign', () => {
    expect(checkReference({ kind: 'entity', id: 'service.orders', scope: 'other-project' } as never, snapshot)).toBe('foreign')
  })
})

const answer = (overrides: Partial<AdapterAnswer>): AdapterAnswer => ({
  interpretation: { description: 'test', assumptions: [] },
  blocks: [],
  evidence: [],
  coverage: { mode: 'top-k', truncated: false, scope: 'default' },
  diagnostics: [],
  ...overrides
})

describe('checkAnswer', () => {
  it('namespaces every block and evidence id by instance, wherever they are cited', () => {
    const checked = checkAnswer(
      'graph',
      answer({
        evidence: [{ id: 'row-1', kind: 'derived-fact', text: 'n: 3', canonicalRefs: [{ kind: 'entity', id: 'service.orders' }] }],
        blocks: [
          { kind: 'metric', id: 'm', label: 'n', value: 3, evidenceIds: ['row-1'] },
          {
            kind: 'table',
            id: 't',
            evidenceIds: [],
            columns: [{ key: 's', label: 's', type: 'reference' }],
            rows: [{ cells: { s: { kind: 'entity', id: 'service.orders' } }, evidenceIds: ['row-1'] }]
          },
          { kind: 'graph', id: 'g', evidenceIds: [], nodes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], edges: [{ source: 'a', target: 'b', rel: 'r', evidenceIds: ['row-1'] }] },
          { kind: 'timeline', id: 'tl', evidenceIds: [], events: [{ label: 'x', at: '2026-10-01', semantics: 'event', evidenceIds: ['row-1'] }] }
        ]
      }),
      snapshot
    )

    expect(validateAdapterAnswer(checked.answer)).toEqual(checked.answer)
    expect(checked.answer.evidence.map((item) => item.id)).toEqual(['graph:row-1'])
    expect(checked.answer.blocks.map((block) => block.id)).toEqual(['graph:m', 'graph:t', 'graph:g', 'graph:tl'])
    expect(JSON.stringify(checked.answer.blocks)).not.toMatch(/"row-1"/)
    expect(checked.references).toEqual({ 'graph:row-1': ['resolved'] })
  })

  it('leaves out results naming no record in scope, drops foreign references, and reports both', () => {
    const checked = checkAnswer(
      'local',
      answer({
        evidence: [
          {
            id: 'p1',
            kind: 'passage',
            text: 'Handles orders.',
            canonicalRefs: [
              { kind: 'entity', id: 'service.orders', revision: 'sha256:old' },
              { kind: 'entity', id: 'service.secret', scope: 'other' } as never,
              { kind: 'entity', id: 'service.ghost' }
            ]
          }
        ],
        blocks: [
          {
            kind: 'entities',
            id: 'hits',
            evidenceIds: ['p1'],
            entities: [{ ref: { kind: 'entity', id: 'service.orders' } }, { ref: { kind: 'entity', id: 'service.ghost' } }]
          },
          { kind: 'entities', id: 'only-ghosts', evidenceIds: [], entities: [{ ref: { kind: 'entity', id: 'service.gone' } }] },
          { kind: 'passages', id: 'passages', evidenceIds: ['p1'] }
        ]
      }),
      snapshot
    )

    expect(validateAdapterAnswer(checked.answer)).toEqual(checked.answer)
    expect(checked.answer.blocks.map((block) => block.id)).toEqual(['local:hits', 'local:passages'])
    expect(checked.answer.blocks[0]).toMatchObject({ entities: [{ ref: { id: 'service.orders' } }] })
    expect(checked.answer.evidence[0]?.canonicalRefs.map((ref) => ref.id)).toEqual(['service.orders', 'service.ghost'])
    expect(checked.references).toEqual({ 'local:p1': ['stale', 'unresolved'] })
    expect(checked.rejected).toEqual(['service.ghost', 'service.gone'])
    expect(JSON.stringify(checked.answer)).not.toContain('service.secret')
    expect(checked.answer.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['reference-not-in-scope', 'foreign-reference', 'stale-reference'])
  })
})

describe('foundReferences', () => {
  it('lists each record once, keeping every adapter that found it and where', () => {
    const local = checkAnswer(
      'local',
      answer({ blocks: [{ kind: 'entities', id: 'hits', evidenceIds: [], entities: [{ ref: { kind: 'entity', id: 'service.orders', revision: 'sha256:old' } }] }] }),
      snapshot
    )
    const graph = checkAnswer(
      'graph',
      answer({
        evidence: [{ id: 'row-1', kind: 'derived-fact', text: 'x', canonicalRefs: [{ kind: 'entity', id: 'service.orders' }, { kind: 'document', id: '.docket/resources/payments.md' }] }],
        blocks: [{ kind: 'facts', id: 'f', evidenceIds: ['row-1'] }]
      }),
      snapshot
    )

    const found = foundReferences(
      [
        { adapter: 'local', sightings: local.sightings },
        { adapter: 'graph', sightings: graph.sightings }
      ],
      snapshot
    )

    expect(found).toEqual([
      {
        kind: 'entity',
        id: 'service.orders',
        status: 'resolved',
        revision: revisionOf('entity', 'service.orders'),
        entity: 'service.orders',
        foundBy: [
          { adapter: 'local', blockIds: ['local:hits'], evidenceIds: [] },
          { adapter: 'graph', blockIds: [], evidenceIds: ['graph:row-1'] }
        ]
      },
      {
        kind: 'document',
        id: '.docket/resources/payments.md',
        status: 'resolved',
        revision: revisionOf('document', '.docket/resources/payments.md'),
        entity: 'team.payments',
        foundBy: [{ adapter: 'graph', blockIds: [], evidenceIds: ['graph:row-1'] }]
      }
    ])
  })
})

describe('resolveReferences', () => {
  it('gives each reference its standing, the record the files hold and the text there', () => {
    const [entity, lines, observation, ghost] = resolveReferences(snapshot, [
      { kind: 'entity', id: 'service.orders' },
      {
        kind: 'document',
        id: '.docket/resources/orders.md',
        revision: revisionOf('document', '.docket/resources/orders.md'),
        span: { path: '.docket/resources/orders.md', startLine: 15, endLine: 15 }
      },
      { kind: 'observation', id: snapshot.state.inputs.find(({ input }) => input.kind === 'observation')?.input.id ?? '' },
      { kind: 'entity', id: 'service.ghost' }
    ])

    expect(entity).toMatchObject({
      status: 'resolved',
      record: { kind: 'entity', id: 'service.orders', entity: 'service.orders', title: 'Orders API', paths: ['.docket/resources/orders.md'] },
      excerpt: { path: '.docket/resources/orders.md', text: expect.stringContaining('Handles orders for checkout.'), truncated: false }
    })
    expect(lines?.excerpt).toEqual({ path: '.docket/resources/orders.md', startLine: 15, endLine: 15, text: 'Stores them in Postgres.', truncated: false })
    expect(observation).toMatchObject({ status: 'resolved', excerpt: { path: 'src/orders/handler.ts', startLine: 40, endLine: 88 } })
    expect(ghost).toEqual({ reference: { kind: 'entity', id: 'service.ghost' }, status: 'unresolved' })
  })
})
