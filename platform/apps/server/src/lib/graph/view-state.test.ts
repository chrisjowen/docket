// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { DEFAULT_STATE, readState, switchView, writeState } from './view-state'

describe('the graph tab address', () => {
  it('is bare for the board with nothing chosen', () => {
    expect(readState(new URLSearchParams())).toEqual(DEFAULT_STATE)
    expect(writeState(DEFAULT_STATE).toString()).toBe('')
  })

  it('round-trips a view, its filters and a selection', () => {
    const query = 'view=facts&focus=service.orders&q=orders+db&type=service&source=code&kind=link&confidence=low&flag=strong&single=1&about=service.orders'
    expect(writeState(readState(new URLSearchParams(query))).toString()).toBe(query)
    expect(writeState(readState(new URLSearchParams('view=evidence&doc=.docket%2Fa.md&bare=1'))).toString()).toBe('view=evidence&doc=.docket%2Fa.md&bare=1')
    expect(writeState(readState(new URLSearchParams('view=facts&flag=weak&open=F-007'))).toString()).toBe('view=facts&flag=weak&open=F-007')
  })

  it('round-trips the network’s query and full screen', () => {
    const query = 'focus=service.orders&q=orders&type=service&tag=payments&full=1'
    const state = readState(new URLSearchParams(query))
    expect(state).toMatchObject({ view: 'graph', q: 'orders', type: 'service', tag: 'payments', full: true })
    expect(writeState(state).toString()).toBe(query)
    expect(readState(new URLSearchParams('full=yes')).full).toBe(false)
  })

  it('keeps the network coloured by confidence across views, and only names it when it is not by type', () => {
    const state = readState(new URLSearchParams('q=band:probable&colour=confidence'))
    expect(state.colour).toBe('confidence')
    expect(writeState(state).toString()).toBe('q=band%3Aprobable&colour=confidence')
    expect(switchView(state, 'facts')).toEqual({ ...DEFAULT_STATE, view: 'facts', colour: 'confidence' })
    expect(readState(new URLSearchParams('colour=rainbow')).colour).toBe('type')
    expect(writeState({ ...state, colour: 'type' }).toString()).toBe('q=band%3Aprobable')
  })

  it('leaves full screen behind for another view', () => {
    const full = readState(new URLSearchParams('q=orders&full=1&focus=service.orders'))
    expect(switchView(full, 'facts')).toEqual({ ...DEFAULT_STATE, view: 'facts', id: 'service.orders' })
  })

  it('reads an older link’s `id` as the selection, and writes it as `focus`', () => {
    expect(readState(new URLSearchParams('id=service.orders')).id).toBe('service.orders')
    expect(writeState(readState(new URLSearchParams('id=service.orders'))).toString()).toBe('focus=service.orders')
  })

  it('falls back to the defaults for values it does not know', () => {
    const state = readState(new URLSearchParams('view=nope&flag=everything&single=yes&show=later&confidence=11&bare=yes&open=service.orders'))
    expect(state).toEqual(DEFAULT_STATE)
  })

  it('starts a view’s filters afresh and keeps the selection', () => {
    const facts = readState(new URLSearchParams('view=facts&flag=weak&id=service.orders'))
    expect(switchView(facts, 'timeline')).toEqual({ ...DEFAULT_STATE, view: 'timeline', id: 'service.orders' })
  })

  it('leaves the open note behind for another view', () => {
    const open = readState(new URLSearchParams('view=facts&id=service.orders&open=F-002'))
    expect(switchView(open, 'graph')).toEqual({ ...DEFAULT_STATE, id: 'service.orders' })
  })
})
