import type { DocumentInput, ObservationInput } from '@docket/contracts'
import { validateCanonicalInput } from '@docket/contracts'
import { describe, expect, it } from 'vitest'

import { entitiesOf, makeDocument } from '../../test/entities.js'
import { toEntityInput } from '../adapters/compat.js'
import type { MemoryDocument } from '../model/index.js'
import { parseMemoryFile } from '../source/parser.js'
import { canonicalState } from './inputs.js'

const IN_CODE = { source: 'code', path: 'src/orders.ts', lines: '12-40', observedAt: '2026-10-05', note: 'opens the pool' }
const RUNNING = { source: 'runtime', symbol: 'deployment/orders' }

const derive = (...documents: MemoryDocument[]) => canonicalState(entitiesOf(documents), documents, 'default')

const observations = (state: ReturnType<typeof derive>): ObservationInput[] =>
  state.inputs.flatMap(({ input }) => (input.kind === 'observation' ? [input] : []))

const documentsOf = (state: ReturnType<typeof derive>): DocumentInput[] =>
  state.inputs.flatMap(({ input }) => (input.kind === 'document' ? [input] : []))

describe('canonicalState', () => {
  it('gives each entity as it always was: its id, with its merged hash as revision', () => {
    const document = makeDocument({ id: 'service.orders', path: '.docket/a.md' })
    const [entity] = entitiesOf([document])
    const state = derive(document)

    expect(state.inputs[0]).toEqual({ input: toEntityInput(entity!, 'default'), owner: 'service.orders' })
    expect(state.inputs[0]?.input.revision).toBe(entity?.hash)
    expect(state.owners).toEqual(new Map([['service.orders', ['.docket/a.md']]]))
  })

  it('gives one observation per distinct evidence record, wherever it is recorded', () => {
    const a = makeDocument({ id: 'service.orders', path: '.docket/a.md', evidence: [IN_CODE] })
    const b = makeDocument({ id: 'service.orders', path: '.docket/b.md', evidence: [IN_CODE, RUNNING] })
    const found = observations(derive(a, b))

    expect(found.map((observation) => [observation.recordedIn, observation.sources])).toEqual([
      [['.docket/a.md', '.docket/b.md'], [{ path: 'src/orders.ts', startLine: 12, endLine: 40 }]],
      [['.docket/b.md'], []]
    ])
    for (const observation of found) expect(validateCanonicalInput(observation)).toEqual(observation)
  })

  it('carries an observed time only when the evidence states one, and never an event time', () => {
    const [stated, unstated] = observations(
      derive(makeDocument({ id: 'service.orders', path: '.docket/a.md', evidence: [IN_CODE, RUNNING] }))
    )
    expect(stated?.observedAt).toBe('2026-10-05')
    expect(unstated).not.toHaveProperty('observedAt')
    expect(stated).not.toHaveProperty('eventAt')
    expect(unstated).not.toHaveProperty('eventAt')
  })

  it('keeps an observation\'s id across edits elsewhere, and gives a corrected record a new one', () => {
    const before = observations(derive(makeDocument({ id: 'service.orders', path: '.docket/a.md', evidence: [IN_CODE] })))
    const retitled = observations(
      derive(makeDocument({ id: 'service.orders', title: 'Order Service', path: '.docket/a.md', evidence: [IN_CODE] }))
    )
    const corrected = observations(
      derive(makeDocument({ id: 'service.orders', path: '.docket/a.md', evidence: [{ ...IN_CODE, lines: '12-41' }] }))
    )

    expect(retitled[0]?.id).toBe(before[0]?.id)
    // What it says changed, so its revision did.
    expect(retitled[0]?.revision).not.toBe(before[0]?.revision)
    expect(corrected[0]?.id).not.toBe(before[0]?.id)
  })

  it('observes a relationship with both its ends', () => {
    const [observation] = observations(
      derive(
        makeDocument({
          id: 'service.orders',
          path: '.docket/a.md',
          links: [{ rel: 'depends_on', target: 'datasource.db', evidence: [{ source: 'manifest', path: 'package.json', key: 'dependencies.pg' }] }]
        })
      )
    )
    expect(observation).toMatchObject({
      entityRefs: ['service.orders', 'datasource.db'],
      relationship: { source: 'service.orders', rel: 'depends_on', target: 'datasource.db' },
      text: 'service.orders depends_on datasource.db seen in manifest at package.json key dependencies.pg'
    })
  })

  it('gives evidence written as YAML numbers, dates or a single URL as the strings the contract defines', () => {
    const raw =
      '---\nid: service.orders\ntype: service\ntitle: Orders\nevidence:\n  - source: code\n    path: src/k8s.ts\n    lines: 22\n    observedAt: 2026-10-05\n    urls: https://example.com/orders\n---\n'
    const [observation] = observations(derive(parseMemoryFile(raw, '.docket/a.md').document!))

    expect(observation?.evidence).toEqual({
      source: 'code',
      path: 'src/k8s.ts',
      lines: '22',
      observedAt: '2026-10-05',
      urls: ['https://example.com/orders']
    })
    expect(observation?.sources).toEqual([{ path: 'src/k8s.ts', startLine: 22, endLine: 22 }])
    expect(validateCanonicalInput(observation)).toEqual(observation)
  })

  it('rejects a file whose evidence gives a commit or key as a number, so none reaches an adapter', () => {
    for (const field of ['commit: 1234567', 'key: 42']) {
      const raw = `---\nid: service.orders\ntype: service\ntitle: Orders\nevidence:\n  - source: code\n    ${field}\n---\n`
      const parsed = parseMemoryFile(raw, '.docket/a.md')
      expect(parsed.document).toBeUndefined()
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['invalid-frontmatter'])
    }
  })

  it('gives each file\'s body as a document whose span is exactly its lines', () => {
    const raw = '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\n\nTakes orders. See [[team.payments]].\nShips them.\n\n'
    const parsed = parseMemoryFile(raw, '.docket/a.md').document!
    const [document] = documentsOf(derive(parsed))

    expect(document).toEqual({
      kind: 'document',
      id: '.docket/a.md',
      revision: parsed.hash,
      scope: 'default',
      text: 'Takes orders. See [[team.payments]].\nShips them.',
      source: { path: '.docket/a.md', startLine: 8, endLine: 9 },
      entityRefs: ['service.orders', 'team.payments']
    })
    expect(raw.split('\n').slice(7, 9).join('\n')).toBe(document?.text)
    expect(validateCanonicalInput(document)).toEqual(document)
  })

  it('gives no document for a file without a body, nor for a file it did not merge', () => {
    const empty = makeDocument({ id: 'service.orders', path: '.docket/a.md', content: '\n\n' })
    const stray = makeDocument({ id: 'team.payments', path: '.docket/b.md', content: 'Left out.' })
    const state = canonicalState(entitiesOf([empty]), [empty, stray], 'default')
    expect(documentsOf(state)).toEqual([])
    expect([...state.owners.keys()]).toEqual(['service.orders'])
  })
})
