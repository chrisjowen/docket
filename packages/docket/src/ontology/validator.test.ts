import { describe, expect, it } from 'vitest'

import {
  DEFAULT_INDEX_FLAGS,
  type MemoryDocument,
  type MemoryEvidence,
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
  path: `.docket/${id}.md`,
  hash: 'sha256:0',
  tags: [],
  attributes,
  links,
  content: '',
  mentions: [],
  evidence: [],
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
      path: '.docket/thing.a.md'
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

  it('checks a link against the type of the first file by path that declares the target', () => {
    const diagnostics = validateDocuments(
      [
        doc('service.a', 'service', {}, [
          { rel: 'depends_on', target: 'service.orders' }
        ]),
        { ...doc('service.orders', 'decision'), path: '.docket/z.md' },
        { ...doc('service.orders', 'service'), path: '.docket/b.md' },
        { ...doc('service.orders', 'decision'), path: '.docket/y.md' }
      ],
      ontology
    )
    expect(codes(diagnostics)).toEqual([])
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

describe('validateDocuments: evidence', () => {
  const seen = (
    evidence: MemoryEvidence[],
    overrides: Partial<MemoryDocument> = {}
  ): MemoryDocument => ({ ...doc('service.a', 'service'), evidence, ...overrides })

  it('accepts evidence that gives the location its source requires', () => {
    const diagnostics = validateDocuments(
      [
        seen([
          { source: 'code', path: 'src/orders.ts', lines: '12-40', symbol: 'OrdersRepository' },
          { source: 'api', method: 'GET', endpoint: '/v1/orders' },
          { source: 'runtime', urls: ['https://grafana.example.com/d/orders'] },
          { source: 'conversation', session: 'abc123', note: 'The user said so.' }
        ])
      ],
      ontology
    )
    expect(diagnostics).toEqual([])
  })

  it('rejects a source kind the ontology does not register', () => {
    const diagnostics = validateDocuments([seen([{ source: 'hearsay' }])], ontology)
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'unknown-evidence-source' })
    ])
    expect(diagnostics[0]?.message).toMatch(/known sources: .*code/)
  })

  it('requires the location fields a source kind names', () => {
    const diagnostics = validateDocuments(
      [
        seen([
          { source: 'code', symbol: 'OrdersRepository' },
          { source: 'api', method: 'GET' },
          { source: 'runtime', note: 'saw it' }
        ])
      ],
      ontology
    )
    expect(codes(diagnostics)).toEqual([
      'evidence-location-missing',
      'evidence-location-missing',
      'evidence-location-missing'
    ])
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/code evidence on service\.a must give path/),
      expect.stringMatching(/api evidence .* must give endpoint/),
      expect.stringMatching(/runtime evidence .* at least one of urls, endpoint, symbol/)
    ])
  })

  it('checks evidence recorded on a link', () => {
    const diagnostics = validateDocuments(
      [
        doc('service.a', 'service', {}, [
          { rel: 'depends_on', target: 'service.b', evidence: [{ source: 'manifest' }] }
        ]),
        doc('service.b', 'service')
      ],
      ontology
    )
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'evidence-location-missing',
        message: expect.stringContaining('link depends_on → service.b')
      })
    ])
  })

  it('takes source kinds from the ontology when it declares them', () => {
    const own: Ontology = {
      ...ontology,
      evidence: { sources: { ticket: { confidence: 0.5, requires: ['urls'] } } }
    }
    expect(codes(validateDocuments([seen([{ source: 'code', path: 'a.ts' }])], own))).toEqual([
      'unknown-evidence-source'
    ])
    expect(
      validateDocuments([seen([{ source: 'ticket', urls: ['https://example.com/T-1'] }])], own)
    ).toEqual([])
  })

  it('warns when an agent captured a resource or link without saying where it saw it', () => {
    const byClaude = {
      ...doc('service.a', 'service', {}, [
        { rel: 'uses', target: 'service.a' },
        { rel: 'owned_by', target: 'team.x', evidence: [{ source: 'config', path: 'CODEOWNERS', lines: '3' }] }
      ]),
      provenance: { capturedBy: 'claude' }
    }
    expect(validateDocuments([byClaude, doc('team.x', 'team')], ontology).map((d) => [d.code, d.message])).toEqual([
      ['missing-evidence', expect.stringContaining('no evidence for the resource')],
      ['missing-evidence', expect.stringContaining('no evidence for link uses → service.a')]
    ])

    // People and files that do not say who wrote them are not nagged.
    expect(validateDocuments([seen([], { provenance: { capturedBy: 'human' } })], ontology)).toEqual([])
    expect(validateDocuments([seen([])], ontology)).toEqual([])
  })

  it('warns that a stated confidence is not used once everything has evidence', () => {
    const evidenced = seen([{ source: 'code', path: 'a.ts' }], { provenance: { confidence: 1 } })
    expect(validateDocuments([evidenced], ontology)).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'stated-confidence-ignored' })
    ])

    // An unevidenced link still takes the stated confidence.
    const partly = { ...evidenced, links: [{ rel: 'uses', target: 'service.a' }] }
    expect(validateDocuments([partly], ontology)).toEqual([])
  })
})
