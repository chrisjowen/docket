// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { docketNumber, docketNumbers, filingsByMonth, sparkline, standingOf, typeCode, weightClass } from './docket'

describe('docket numbers', () => {
  it('take three letters of the address, the year opened and the order opened', () => {
    expect(docketNumber('platform', '2026-02-07T10:00:00Z', 1)).toBe('PLA-26-0001')
    expect(docketNumber('a-1', '2025-12-31T23:00:00Z', 12)).toBe('A1X-25-0012')
    expect(docketNumber('---', '2026-01-01T00:00:00Z', 3)).toBe('DKT-26-0003')
  })

  it('number a casebook by when each docket was opened, not by name', () => {
    const numbers = docketNumbers([
      { slug: 'payments', createdAt: new Date('2026-03-01T00:00:00Z') },
      { slug: 'identity', createdAt: new Date('2026-01-01T00:00:00Z') },
      { slug: 'data', createdAt: '2026-02-01T00:00:00Z' },
    ])
    expect(Object.fromEntries(numbers)).toEqual({ identity: 'IDE-26-0001', data: 'DAT-26-0002', payments: 'PAY-26-0003' })
  })
})

describe('standing', () => {
  const now = new Date('2026-11-13T12:00:00Z')

  it('is active with a filing in the last 30 days', () => {
    expect(standingOf('2026-11-01T00:00:00Z', now)).toBe('active')
    expect(standingOf('2026-10-14T13:00:00Z', now)).toBe('active')
  })

  it('is dormant after 30 days without one, or with none at all', () => {
    expect(standingOf('2026-10-13T11:00:00Z', now)).toBe('dormant')
    expect(standingOf(null, now)).toBe('dormant')
  })
})

describe('filings by month', () => {
  it('counts the last twelve calendar months, oldest first', () => {
    const now = new Date('2026-11-13T12:00:00Z')
    const counts = filingsByMonth(['2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z', '2026-10-31T23:59:00Z', '2025-12-02T00:00:00Z', '2025-11-30T00:00:00Z'], now)
    expect(counts).toHaveLength(12)
    expect(counts[11]).toBe(2)
    expect(counts[10]).toBe(1)
    expect(counts[0]).toBe(1)
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(4)
  })
})

describe('sparkline', () => {
  it('draws a line across the box and closes the area under it', () => {
    const { line, area } = sparkline([0, 2, 1], 100, 20)
    expect(line).toBe('M0 18 L50 2 L100 10')
    expect(area).toBe('M0 18 L50 2 L100 10 L100 20 L0 20 Z')
  })

  it('draws nothing for no values', () => {
    expect(sparkline([])).toEqual({ line: '', area: '' })
  })
})

describe('type codes', () => {
  it('use the known codes, else three letters of the type', () => {
    expect(typeCode('service')).toBe('SVC')
    expect(typeCode('Datastore')).toBe('DS')
    expect(typeCode('capability')).toBe('CAP')
    expect(typeCode('--')).toBe('?')
  })
})

describe('weight of evidence', () => {
  it('is weak under 50% and middling under 85%', () => {
    expect(weightClass(0.49)).toBe('low')
    expect(weightClass(0.5)).toBe('mid')
    expect(weightClass(0.85)).toBe('high')
  })
})
