import { describe, expect, it } from 'vitest'

import { makeDocument } from '../../test/entities.js'
import type { MemoryEvidence } from '../model/index.js'
import { aggregate } from './aggregate.js'
import { builtinOntology, confidenceModel } from './confidence.js'

const model = confidenceModel(builtinOntology())

const inCode: MemoryEvidence = { source: 'code', path: 'src/k8s.ts', lines: '14-30', symbol: 'ordersDeployment' }
const running: MemoryEvidence = { source: 'runtime', symbol: 'deployment/orders-api' }
const inManifest: MemoryEvidence = { source: 'manifest', path: 'package.json', key: 'dependencies.pg' }

describe('aggregate', () => {
  it('turns a lone file into an entity with its confidence computed', () => {
    const document = makeDocument({
      id: 'pod.orders-api',
      content: 'Serves orders.\n',
      evidence: [inCode],
      links: [{ rel: 'runs_in', target: 'cluster.prod' }]
    })
    const { entities, diagnostics } = aggregate([document], model)

    expect(diagnostics).toEqual([])
    expect(entities).toEqual([
      {
        ...document,
        paths: [document.path],
        hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        // A pod read from code is weak evidence until something else confirms it.
        confidence: 0.3,
        basis: 'evidence',
        evidenceCount: 1,
        sources: ['code'],
        // A link is judged on what was seen of it, and none of it was.
        links: [
          {
            rel: 'runs_in',
            target: 'cluster.prod',
            evidence: [],
            confidence: 0.5,
            basis: 'unevidenced',
            evidenceCount: 0,
            sources: []
          }
        ]
      }
    ])
  })

  it('merges files that declare one id, keeping every observation and corroborating across them', () => {
    const fromCode = makeDocument({
      id: 'pod.orders-api',
      path: '.docket/resources/pods/orders-api.md',
      title: 'Orders API pod',
      tags: ['orders'],
      attributes: { namespace: 'orders', replicas: 2 },
      content: 'Built in code.\n',
      mentions: ['service.orders'],
      evidence: [inCode],
      links: [
        { rel: 'depends_on', target: 'secret.db', evidence: [inCode] },
        { rel: 'runs_in', target: 'cluster.prod', attributes: { zone: 'eu' } }
      ]
    })
    const fromCluster = makeDocument({
      id: 'pod.orders-api',
      path: '.docket/resources/pods/zz-orders-api-running.md',
      title: 'orders-api',
      tags: ['orders', 'k8s'],
      attributes: { namespace: 'orders', replicas: 3, kind: 'deployment' },
      content: 'Seen running with three replicas.\n',
      evidence: [running, inCode],
      links: [{ rel: 'depends_on', target: 'secret.db', evidence: [running] }]
    })

    const { entities, diagnostics } = aggregate([fromCluster, fromCode], model)

    expect(entities).toHaveLength(1)
    const [pod] = entities
    expect(pod).toMatchObject({
      id: 'pod.orders-api',
      // The first file by path names it, and its values stand.
      title: 'Orders API pod',
      path: fromCode.path,
      paths: [fromCode.path, fromCluster.path],
      tags: ['orders', 'k8s'],
      attributes: { namespace: 'orders', replicas: 2, kind: 'deployment' },
      mentions: ['service.orders'],
      content: 'Built in code.\n\nSeen running with three replicas.\n',
      // The same sighting recorded twice is one observation.
      evidence: [inCode, running],
      evidenceCount: 2,
      confidence: 0.93,
      sources: ['code', 'runtime']
    })

    // One link per (rel, target), with the evidence from both files.
    expect(pod?.links.map((link) => [link.rel, link.target, link.evidenceCount, link.confidence])).toEqual([
      ['depends_on', 'secret.db', 2, 0.97],
      ['runs_in', 'cluster.prod', 0, 0.5]
    ])

    // A disagreement is reported, not silently resolved by the later file.
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'conflicting-attribute',
        path: fromCluster.path,
        message: expect.stringContaining('"replicas" is 2')
      })
    ])
  })

  it('keeps one link however many times a file repeats it', () => {
    const { entities } = aggregate(
      [
        makeDocument({
          id: 'service.orders',
          links: [
            { rel: 'depends_on', target: 'datasource.db', evidence: [inManifest] },
            { rel: 'depends_on', target: 'datasource.db', evidence: [inCode] }
          ]
        })
      ],
      model
    )
    expect(entities[0]?.links).toEqual([
      expect.objectContaining({ rel: 'depends_on', target: 'datasource.db', evidenceCount: 2, confidence: 0.98 })
    ])
  })

  it('leaves out a file that gives the id another type', () => {
    const { entities, diagnostics } = aggregate(
      [
        makeDocument({ id: 'service.orders', path: '.docket/a.md', type: 'service' }),
        makeDocument({ id: 'service.orders', path: '.docket/b.md', type: 'library', tags: ['lib'] })
      ],
      model
    )
    expect(entities.map((entity) => [entity.type, entity.paths, entity.tags])).toEqual([
      ['service', ['.docket/a.md'], []]
    ])
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'conflicting-type', path: '.docket/b.md' })
    ])
  })

  it('uses the highest stated confidence when no file records evidence', () => {
    const { entities } = aggregate(
      [
        makeDocument({ id: 'team.payments', path: '.docket/a.md', provenance: { confidence: 0.7 } }),
        makeDocument({ id: 'team.payments', path: '.docket/b.md', provenance: { confidence: 0.9 } }),
        makeDocument({ id: 'team.platform' })
      ],
      model
    )
    expect(entities.map((entity) => [entity.id, entity.confidence, entity.basis])).toEqual([
      ['team.payments', 0.9, 'stated'],
      ['team.platform', 0.5, 'unevidenced']
    ])
  })

  it('keeps a file out of an index only if every file of the id allows it', () => {
    const { entities } = aggregate(
      [
        makeDocument({ id: 'secret.db', path: '.docket/a.md' }),
        makeDocument({ id: 'secret.db', path: '.docket/b.md', index: { graph: true, fts: true, vector: false } })
      ],
      model
    )
    expect(entities[0]?.index).toEqual({ graph: true, fts: true, vector: false })
  })

  it('gives the same entities, hashes included, whatever order the files arrive in', () => {
    const files = [
      makeDocument({ id: 'pod.a', path: '.docket/1.md', evidence: [inCode] }),
      makeDocument({ id: 'pod.a', path: '.docket/2.md', evidence: [running] }),
      makeDocument({ id: 'team.x', path: '.docket/0.md' })
    ]
    const forward = aggregate(files, model)
    const backward = aggregate([...files].reverse(), model)
    expect(backward).toEqual(forward)
    expect(forward.entities.map((entity) => entity.id)).toEqual(['team.x', 'pod.a'])

    // The hash follows what is projected: new evidence changes it.
    const more = aggregate([...files, makeDocument({ id: 'pod.a', path: '.docket/3.md', evidence: [inManifest] })], model)
    expect(more.entities[1]?.hash).not.toBe(forward.entities[1]?.hash)
  })
})
