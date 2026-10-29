import { describe, expect, it, vi } from 'vitest'

import { CASEBOOK_SCHEMA, connect, isCasebookData, type CasebookData, type ServiceView } from './host.js'

const WHEELHOUSE = 'http://127.0.0.1:4310'
const VIEWER = 'http://127.0.0.1:4400'

const data = (over: Partial<CasebookData> = {}): CasebookData => ({
  schema: CASEBOOK_SCHEMA,
  state: 'docket',
  root: '/work/shop',
  configuredRoot: false,
  origins: [WHEELHOUSE],
  problem: null,
  ...over
})

const view = (over: Partial<ServiceView> = {}): ServiceView => ({
  state: 'running',
  url: VIEWER,
  reason: null,
  launchable: true,
  hint: 'cd /work/shop && docket open --port 4400',
  ...over
})

const healthy = async () => ({ service: 'docket-open', root: '/work/shop', allowOrigins: [WHEELHOUSE] })

describe('connect', () => {
  it('draws the casebook from a running viewer that answers this page', async () => {
    const probe = vi.fn(healthy)
    expect(await connect(data(), view(), WHEELHOUSE, probe)).toEqual({ state: 'connected', url: VIEWER })
    expect(probe).toHaveBeenCalledWith(VIEWER)
  })

  it('offers Launch for a stopped viewer, and says it is starting while it starts', async () => {
    expect(await connect(data(), view({ state: 'stopped' }), WHEELHOUSE, healthy)).toMatchObject({
      state: 'offline',
      title: 'docket’s viewer is not running',
      launchable: true,
      starting: false,
      hint: 'cd /work/shop && docket open --port 4400'
    })
    expect(await connect(data(), view({ state: 'starting' }), WHEELHOUSE, healthy)).toMatchObject({ state: 'offline', starting: true })
    expect(await connect(data(), view({ state: 'failed', reason: 'It exited.' }), WHEELHOUSE, healthy)).toMatchObject({
      title: 'docket’s viewer did not start',
      detail: 'It exited.'
    })
  })

  it('says a viewer the browser keeps from this page was not started for Wheelhouse', async () => {
    const refused = await connect(data(), view(), WHEELHOUSE, () => Promise.reject(new TypeError('Failed to fetch')))
    expect(refused).toMatchObject({ state: 'offline', title: 'docket’s viewer does not answer this page', launchable: false })
  })

  it('says an answer that is not docket open’s health is from a docket too old', async () => {
    expect(await connect(data(), view(), WHEELHOUSE, async () => null)).toMatchObject({ title: 'docket’s viewer is out of date' })
  })

  it('stops at a page the viewer is not started to allow, saying which setting to change', async () => {
    const result = await connect(data(), view(), 'http://127.0.0.1:5173', healthy)
    expect(result).toMatchObject({ state: 'blocked' })
    expect(result.state === 'blocked' && result.detail).toContain('Add "http://127.0.0.1:5173" to "origins"')
  })

  it('stops with the provider’s reason, with no docket, or without its value', async () => {
    expect(await connect(data({ problem: 'docket is too old.' }), view(), WHEELHOUSE, healthy)).toMatchObject({ state: 'blocked', detail: 'docket is too old.' })
    expect(await connect(data({ state: 'none' }), view(), WHEELHOUSE, healthy)).toMatchObject({ state: 'blocked', title: 'No docket here' })
    expect(await connect(null, view(), WHEELHOUSE, healthy)).toMatchObject({ state: 'blocked' })
    expect(await connect(data(), null, WHEELHOUSE, healthy)).toMatchObject({ state: 'blocked' })
  })

  it('knows the provider’s value by its schema', () => {
    expect(isCasebookData(data())).toBe(true)
    expect(isCasebookData({ state: 'docket' })).toBe(false)
    expect(isCasebookData(null)).toBe(false)
  })
})
