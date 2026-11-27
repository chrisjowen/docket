// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { askScope, recalled, remember, scopeKind, scopeLabel } from './scope'

const all = ['platform', 'payments', 'data']

describe('the dockets Ask asks', () => {
  it('asks every docket when nothing chooses', () => {
    expect(askScope({ all })).toEqual(all)
  })

  it('keeps a Chat tab to its own docket, whatever else names others', () => {
    expect(askScope({ all, docket: 'payments', named: ['platform'], chat: ['data'], remembered: 'all' })).toEqual(['payments'])
  })

  it('asks the dockets the address names first, in the casebook’s order', () => {
    expect(askScope({ all, named: ['data', 'platform'], chat: ['payments'], remembered: 'payments' })).toEqual(['platform', 'data'])
  })

  it('asks an open chat’s dockets when the address names none', () => {
    expect(askScope({ all, chat: ['payments'], remembered: 'data' })).toEqual(['payments'])
  })

  it('remembers the last scope instead of resetting to all', () => {
    expect(askScope({ all, remembered: 'payments' })).toEqual(['payments'])
    expect(askScope({ all, remembered: 'payments,data' })).toEqual(['payments', 'data'])
  })

  it('falls through a source naming no docket the member reaches', () => {
    expect(askScope({ all, named: ['gone'], remembered: 'data' })).toEqual(['data'])
    expect(askScope({ all, remembered: 'gone' })).toEqual(all)
  })
})

describe('the remembered scope', () => {
  it('remembers every docket as all, so dockets opened later join in', () => {
    expect(remember(all, all)).toBe('all')
    expect(recalled([...all, 'new'], 'all')).toEqual([...all, 'new'])
  })

  it('remembers the chosen dockets, and nothing when none is chosen', () => {
    expect(remember(all, ['data', 'platform'])).toBe('platform,data')
    expect(remember(all, ['gone'])).toBeNull()
    expect(recalled(all, 'platform,data')).toEqual(['platform', 'data'])
    expect(recalled(all, null)).toEqual([])
  })
})

describe('the scope chip', () => {
  const name = (slug: string) => slug.toUpperCase()

  it('reads as all dockets, one, several or none', () => {
    expect([scopeKind(all, all), scopeLabel(all, all, name)]).toEqual(['all', 'All 3 dockets'])
    expect([scopeKind(all, ['data']), scopeLabel(all, ['data'], name)]).toEqual(['one', 'DATA'])
    expect([scopeKind(all, ['data', 'payments']), scopeLabel(all, ['data', 'payments'], name)]).toEqual(['several', '2 dockets'])
    expect([scopeKind(all, []), scopeLabel(all, [], name)]).toEqual(['none', 'Choose dockets'])
  })

  it('names the lone docket of a casebook with one', () => {
    expect(scopeLabel(['data'], ['data'], name)).toBe('DATA')
  })
})
