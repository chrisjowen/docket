import type { InputKind } from '@docket/contracts'
import { describe, expect, it } from 'vitest'

import { entitiesOf, makeDocument } from '../../test/entities.js'
import { canonicalState } from '../sync/inputs.js'
import { emptyRecords } from './adapter-manifest.js'
import { manifestEntry, planAdapter, planProjection } from './plan.js'

const [orders, payments] = entitiesOf([
  makeDocument({ id: 'service.orders', path: '.docket/a.md' }),
  makeDocument({ id: 'service.orders', path: '.docket/b.md' }),
  makeDocument({ id: 'team.payments', path: '.docket/c.md' })
])
if (!orders || !payments) throw new Error('fixtures')

describe('planProjection', () => {
  it('projects what changed, leaves what did not and removes what is gone', () => {
    const plan = planProjection([orders, payments], new Set(), {
      'service.orders': { path: '.docket/a.md', hash: 'sha256:stale' },
      'team.payments': manifestEntry(payments),
      'team.gone': { path: '.docket/gone.md', hash: 'sha256:gone' }
    })

    expect(plan.upserts.map((entity) => entity.id)).toEqual(['service.orders'])
    expect(plan.unchanged).toBe(1)
    expect(plan.removals).toEqual(['team.gone'])
    expect(plan.next).toEqual({
      'service.orders': { path: '.docket/a.md', paths: ['.docket/a.md', '.docket/b.md'], hash: orders.hash },
      'team.payments': { path: '.docket/c.md', hash: payments.hash }
    })
  })

  it('holds an entity whose previously projected file is broken, rather than erasing what it gave', () => {
    const previous = { 'service.orders': { path: '.docket/a.md', paths: ['.docket/a.md', '.docket/b.md'], hash: 'sha256:old' } }

    // b.md is broken: what is left would project without it, so nothing moves.
    const held = planProjection([orders], new Set(['.docket/b.md']), previous)
    expect(held).toEqual({ upserts: [], removals: [], unchanged: 0, next: previous })

    // Even when no file of it is valid any more.
    expect(planProjection([], new Set(['.docket/a.md']), previous).removals).toEqual([])
  })

  it('projects a new entity even while a file that never contributed to it is broken', () => {
    const plan = planProjection([payments], new Set(['.docket/broken.md']), {})
    expect(plan.upserts).toEqual([payments])
  })
})

describe('planAdapter', () => {
  const documents = [
    makeDocument({ id: 'service.orders', path: '.docket/a.md', content: 'Orders.', evidence: [{ source: 'code', path: 'src/a.ts' }] }),
    makeDocument({ id: 'service.orders', path: '.docket/b.md' }),
    makeDocument({ id: 'team.payments', path: '.docket/c.md', content: 'Payments.' })
  ]
  const state = canonicalState(entitiesOf(documents), documents, 'default')
  const ALL = new Set<InputKind>(['entity', 'observation', 'document'])
  const nothing = { owners: {}, records: emptyRecords() }

  /** The manifest an instance taking `inputs` holds once it acknowledged everything planned. */
  const applied = (inputs: ReadonlySet<InputKind>) => {
    const plan = planAdapter(state, nothing, { inputs, broken: new Set() })
    const records = emptyRecords()
    for (const { change, owner } of plan.changes) {
      if (change.operation !== 'upsert') continue
      records[change.record.kind][change.record.id] = {
        revision: change.record.revision,
        ...(owner !== change.record.id ? { owner } : {})
      }
    }
    return { owners: plan.owners, records }
  }

  const refs = (plan: ReturnType<typeof planAdapter>) =>
    plan.changes.map(({ change }) =>
      change.operation === 'upsert' ? `+${change.record.kind}:${change.record.id}` : `-${change.kind}:${change.id}`
    )

  it('plans only the kinds the instance declares', () => {
    const entitiesOnly = planAdapter(state, nothing, { inputs: new Set(['entity']), broken: new Set() })
    expect(refs(entitiesOnly)).toEqual(['+entity:service.orders', '+entity:team.payments'])

    const recall = planAdapter(state, nothing, { inputs: new Set(['observation', 'document']), broken: new Set() })
    expect(refs(recall)).toEqual([
      expect.stringMatching(/^\+observation:service\.orders#/),
      '+document:.docket/a.md',
      '+document:.docket/c.md'
    ])
    // Every entity is recorded with its files, whichever kinds the instance takes.
    expect(recall.owners).toEqual({ 'service.orders': ['.docket/a.md', '.docket/b.md'], 'team.payments': ['.docket/c.md'] })
  })

  it('plans nothing for what the instance already holds, and removes derived records before entities', () => {
    const manifest = applied(ALL)
    expect(planAdapter(state, manifest, { inputs: ALL, broken: new Set() })).toMatchObject({ changes: [], unchanged: 5 })

    const gone = canonicalState([], [], 'default')
    expect(refs(planAdapter(gone, manifest, { inputs: ALL, broken: new Set() }))).toEqual([
      '-document:.docket/a.md',
      '-document:.docket/c.md',
      expect.stringMatching(/^-observation:service\.orders#/),
      '-entity:service.orders',
      '-entity:team.payments'
    ])
  })

  it('holds every record of an entity one of whose files is broken', () => {
    const manifest = applied(ALL)
    const without = documents.filter((document) => document.path !== '.docket/b.md')
    const broken = canonicalState(entitiesOf(without), without, 'default')

    const plan = planAdapter(broken, manifest, { inputs: ALL, broken: new Set(['.docket/b.md']) })
    expect(plan.changes).toEqual([])
    expect([...plan.held]).toEqual(['service.orders'])
    expect(plan.owners['service.orders']).toEqual(['.docket/a.md', '.docket/b.md'])
  })

  it('plans only within the scope it is given', () => {
    const manifest = applied(ALL)
    const scoped = planAdapter(canonicalState([], [], 'default'), manifest, {
      inputs: ALL,
      broken: new Set(),
      scope: new Set(['team.payments'])
    })
    expect(refs(scoped)).toEqual(['-document:.docket/c.md', '-entity:team.payments'])
    expect(Object.keys(scoped.owners)).toEqual(['service.orders'])
  })
})
