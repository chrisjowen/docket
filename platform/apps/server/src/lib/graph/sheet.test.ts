// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { docketText, exhibitLabel } from './sheet'

const change = (action: string, paths: string[], evidenceCount = 0, resourceId: string | null = null) => ({
  id: 'e1',
  at: '2026-10-01T09:00:01.000Z',
  channel: 'ui',
  action,
  actorLabel: '@alice',
  outcome: 'ok',
  resourceId,
  documents: paths.map((path) => ({ path, change: 'updated' })),
  evidenceCount,
  requestId: 'r1',
})

describe('an exhibit’s label', () => {
  it('takes the docket number’s first letter', () => {
    expect(exhibitLabel('PLA-26-0001', 12)).toBe('Ex. P-12')
    expect(exhibitLabel('', 3)).toBe('Ex. D-3')
  })
})

describe('a docket entry’s text', () => {
  it('words a change from the activity log', () => {
    expect(docketText({ kind: 'change', field: 'add-evidence', change: change('add-evidence', ['.docket/a.md'], 1) })).toBe('Added evidence to .docket/a.md, 1 exhibit.')
    expect(docketText({ kind: 'change', field: 'add-evidence', change: change('add-evidence', ['.docket/a.md'], 2, 'service.orders') })).toBe('Added evidence, 2 exhibits.')
    expect(docketText({ kind: 'change', field: 'repo-sync', change: change('repo-sync', ['.docket/a.md', '.docket/b.md']) })).toBe('Synced from the repo: 2 documents.')
  })

  it('quotes the evidence a filing or an event rests on', () => {
    expect(docketText({ kind: 'observed', field: 'observedAt', evidence: { source: 'code', path: 'orders/main.go' } })).toBe('orders/main.go')
    expect(docketText({ kind: 'event', field: 'eventAt', evidence: { note: 'cut over to Postgres' } })).toBe('Happened: cut over to Postgres.')
  })

  it('names the date a document records', () => {
    expect(docketText({ kind: 'decision', field: 'decided_at' })).toBe('Decided at.')
    expect(docketText({ kind: 'event', field: 'reviewBy' })).toBe('Review by.')
  })
})
