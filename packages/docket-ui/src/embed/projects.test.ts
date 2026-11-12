import { describe, expect, it } from 'vitest'

import type { ServiceView } from './host.js'
import { added, casebookHref, isProjectsData, PROJECTS_SCHEMA } from './projects.js'

const view = (over: Partial<ServiceView> = {}): ServiceView => ({
  state: 'running',
  url: 'http://127.0.0.1:4400',
  reason: null,
  launchable: true,
  hint: 'cd /work/shop && docket open --port 4400 --init',
  ...over
})

describe('the Docket page’s value', () => {
  it('is the projects provider’s, and nothing else', () => {
    expect(isProjectsData({ schema: PROJECTS_SCHEMA, projects: [], problem: null, docket: null })).toBe(true)
    expect(isProjectsData({ schema: 'wheelhouse-docket-casebook.v1', projects: [] })).toBe(false)
    expect(isProjectsData({ schema: PROJECTS_SCHEMA })).toBe(false)
    expect(isProjectsData(null)).toBe(false)
  })

  it('links a project to its Docket tab in Wheelhouse', () => {
    expect(casebookHref('docket', 'shop')).toBe('/projects/shop/docket/casebook')
    expect(casebookHref('docket', 'my shop')).toBe('/projects/my%20shop/docket/casebook')
  })
})

describe('Add Docket', () => {
  it('has added docket once the viewer runs, or is starting', () => {
    expect(added(view())).toEqual({ ok: true })
    expect(added(view({ state: 'starting' }))).toEqual({ ok: true })
  })

  it('says why not, with the launch log and the command to do it by hand', () => {
    expect(added(view({ state: 'failed', reason: 'It exited.', log: 'Error: EACCES' }))).toEqual({
      ok: false,
      reason: 'It exited.',
      log: 'Error: EACCES',
      hint: 'cd /work/shop && docket open --port 4400 --init'
    })
    expect(added(view({ state: 'occupied', reason: null }))).toMatchObject({ ok: false, reason: 'Something else answers at the viewer’s address.' })
    expect(added(null)).toMatchObject({ ok: false, reason: 'This Wheelhouse has no docket viewer for this project.' })
  })
})
