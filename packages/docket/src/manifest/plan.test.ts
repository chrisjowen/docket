import { describe, expect, it } from 'vitest'

import { entitiesOf, makeDocument } from '../../test/entities.js'
import { manifestEntry, planProjection } from './plan.js'

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
