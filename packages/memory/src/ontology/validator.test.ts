import { describe, expect, it } from 'vitest'

import {
  DEFAULT_INDEX_FLAGS,
  type MemoryDocument,
  type MemoryLink,
  type Ontology
} from '../model/index.js'
import { validateDocuments } from './validator.js'

const ontology: Ontology = {
  version: 1,
  resourceTypes: {
    service: {
      attributes: {
        language: { type: 'string' },
        replicas: { type: 'number' },
        public: { type: 'boolean' },
        tags: { type: 'string[]' },
        ports: { type: 'number[]' },
        lifecycle: { type: 'string', enum: ['active', 'retired'] },
        zones: { type: 'string[]', enum: ['eu', 'us'] }
      }
    },
    team: {},
    decision: {}
  },
  relationships: {
    owned_by: { from: ['service'], to: ['team'] },
    depends_on: {
      from: ['service'],
      to: ['service'],
      attributes: { criticality: { type: 'string', enum: ['low', 'high'] } }
    },
    uses: { from: '*', to: '*' }
  }
}

const doc = (
  id: string,
  type: string,
  attributes: Record<string, unknown> = {},
  links: MemoryLink[] = []
): MemoryDocument => ({
  id,
  type,
  title: id,
  path: `.memory/${id}.md`,
  hash: 'sha256:0',
  tags: [],
  attributes,
  links,
  content: '',
  mentions: [],
  index: DEFAULT_INDEX_FLAGS
})

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code)

describe('validateDocuments', () => {
  it('reports unknown resource types', () => {
    const diagnostics = validateDocuments([doc('thing.a', 'widget')], ontology)
    expect(codes(diagnostics)).toEqual(['unknown-type'])
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      id: 'thing.a',
      path: '.memory/thing.a.md'
    })
  })

  it('warns on undeclared attributes', () => {
    const diagnostics = validateDocuments(
      [doc('service.a', 'service', { nope: 1 })],
      ontology
    )
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'unknown-attribute'
    })
  })

  it('reports enum violations', () => {
    const diagnostics = validateDocuments(
      [doc('service.a', 'service', { lifecycle: 'zombie' })],
      ontology
    )
    expect(codes(diagnostics)).toEqual(['attribute-enum-violation'])
  })

  it('reports wrong attribute value types', () => {
    const diagnostics = validateDocuments(
      [doc('service.a', 'service', { language: 5, replicas: 'two' })],
      ontology
    )
    expect(codes(diagnostics)).toEqual([
      'attribute-type-mismatch',
      'attribute-type-mismatch'
    ])
  })

  it('validates array attribute kinds element by element', () => {
    const ok = validateDocuments(
      [
        doc('service.a', 'service', {
          tags: ['a', 'b'],
          ports: [80, 443],
          zones: ['eu']
        })
      ],
      ontology
    )
    expect(ok).toEqual([])

    const bad = validateDocuments(
      [
        doc('service.a', 'service', {
          tags: ['a', 3],
          zones: ['eu', 'mars']
        })
      ],
      ontology
    )
    expect(codes(bad)).toEqual([
      'attribute-type-mismatch',
      'attribute-enum-violation'
    ])
  })

  it('reports unknown relationships', () => {
    const diagnostics = validateDocuments(
      [doc('service.a', 'service', {}, [{ rel: 'orbits', target: 'team.x' }])],
      ontology
    )
    expect(codes(diagnostics)).toEqual(['unknown-relationship'])
  })

  it('reports a link violating its from constraint', () => {
    const diagnostics = validateDocuments(
      [
        doc('team.x', 'team', {}, [{ rel: 'owned_by', target: 'team.y' }]),
        doc('team.y', 'team')
      ],
      ontology
    )
    expect(codes(diagnostics)).toEqual(['relationship-from-violation'])
  })

  it('reports a link violating its to constraint', () => {
    const diagnostics = validateDocuments(
      [
        doc('service.a', 'service', {}, [
          { rel: 'owned_by', target: 'decision.d' }
        ]),
        doc('decision.d', 'decision')
      ],
      ontology
    )
    expect(codes(diagnostics)).toEqual(['relationship-to-violation'])
  })

  it('accepts anything for "*" constraints', () => {
    const diagnostics = validateDocuments(
      [
        doc('decision.d', 'decision', {}, [
          { rel: 'uses', target: 'team.x' }
        ]),
        doc('team.x', 'team')
      ],
      ontology
    )
    expect(diagnostics).toEqual([])
  })

  it('validates link attributes against the relationship', () => {
    const diagnostics = validateDocuments(
      [
        doc('service.a', 'service', {}, [
          {
            rel: 'depends_on',
            target: 'service.b',
            attributes: { criticality: 'medium', extra: true }
          }
        ]),
        doc('service.b', 'service')
      ],
      ontology
    )
    expect(codes(diagnostics)).toEqual([
      'link-attribute-enum-violation',
      'unknown-link-attribute'
    ])
  })

  it('treats dangling references as warnings by default and errors under strict', () => {
    const documents = [
      doc('service.a', 'service', {}, [
        { rel: 'owned_by', target: 'team.missing' }
      ])
    ]

    expect(validateDocuments(documents, ontology)[0]).toMatchObject({
      severity: 'warning',
      code: 'dangling-reference'
    })
    expect(
      validateDocuments(documents, ontology, { strict: true })[0]
    ).toMatchObject({ severity: 'error', code: 'dangling-reference' })
  })

  it('produces no diagnostics for a fully valid document set', () => {
    const documents = [
      doc(
        'service.a',
        'service',
        { language: 'ts', replicas: 2, public: true, lifecycle: 'active' },
        [
          { rel: 'owned_by', target: 'team.x' },
          {
            rel: 'depends_on',
            target: 'service.b',
            attributes: { criticality: 'high' }
          }
        ]
      ),
      doc('service.b', 'service'),
      doc('team.x', 'team')
    ]
    expect(validateDocuments(documents, ontology)).toEqual([])
  })
})
