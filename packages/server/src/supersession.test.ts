import { describe, expect, it } from 'vitest'

import { changeNote, currentRecord, dayOf } from './supersession.js'

describe('supersession notes', () => {
  it('follows a chain of replacements to the current record, and stops at a loop', () => {
    const chain = new Map([
      ['service.a', { supersededBy: 'service.b' }],
      ['service.b', { supersededBy: 'service.c' }]
    ])
    expect(currentRecord(chain, 'service.a')).toBe('service.c')
    expect(currentRecord(chain, 'service.z')).toBe('service.z')
    const loop = new Map([
      ['service.a', { supersededBy: 'service.b' }],
      ['service.b', { supersededBy: 'service.a' }]
    ])
    expect(currentRecord(loop, 'service.a')).toBe('service.b')
  })

  it('says what is out of date, since when, what replaces it and why', () => {
    const until = new Date('2026-11-01T00:00:00.000Z')
    expect(dayOf(until)).toBe('2026-11-01')
    expect(changeNote({ id: 'service.payments', title: 'Payments' }, { id: 'service.billing', title: 'Billing' }, { validUntil: until, reason: ' Billing   replaced it ' })).toBe(
      'Out of date: "Payments" (service.payments) is superseded by "Billing" (service.billing) since 2026-11-01. Billing replaced it.'
    )
    expect(changeNote({ id: 'service.payments', title: 'Payments' }, null, { validUntil: '2026-11-01', reason: '' })).toBe(
      'Out of date: "Payments" (service.payments) is superseded by a record no longer on file since 2026-11-01.'
    )
  })
})
