// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { crumbsFor } from './crumbs'

const org = { slug: 'acme', name: 'Acme' }
const workspace = { slug: 'platform', name: 'Platform' }

describe('breadcrumbs', () => {
  it('name the casebook on its own page, and lead back to it from an org page', () => {
    expect(crumbsFor({ routeId: '/a/[acct]', pathname: '/a/acme', org })).toEqual([{ label: 'Acme' }])
    expect(crumbsFor({ routeId: '/a/[acct]/members', pathname: '/a/acme/members', org })).toEqual([
      { label: 'Acme', href: '/a/acme' },
      { label: 'Users' },
    ])
  })

  it("end on the docket on its overview, and on the section elsewhere", () => {
    expect(crumbsFor({ routeId: '/a/[acct]/d/[docket]/overview', pathname: '/a/acme/d/platform/overview', org, workspace })).toEqual([
      { label: 'Acme', href: '/a/acme' },
      { label: 'Platform' },
    ])
    expect(crumbsFor({ routeId: '/a/[acct]/d/[docket]/graph', pathname: '/a/acme/d/platform/graph', org, workspace })).toEqual([
      { label: 'Acme', href: '/a/acme' },
      { label: 'Platform', href: '/a/acme/d/platform/overview' },
      { label: 'Record' },
    ])
  })

  it("link a nested page's section", () => {
    expect(crumbsFor({ routeId: '/a/[acct]/d/[docket]/ontology/history', pathname: '/a/acme/d/platform/ontology/history', org, workspace }).at(-1)).toEqual({
      label: 'Schema',
      href: '/a/acme/d/platform/ontology',
    })
  })

  it("lead from a space's pages back to the space", () => {
    const space = { slug: 'engineering', name: 'Engineering' }
    expect(crumbsFor({ routeId: '/a/[acct]/s/[space]', pathname: '/a/acme/s/engineering', org, space })).toEqual([
      { label: 'Acme', href: '/a/acme' },
      { label: 'Engineering' },
    ])
    expect(crumbsFor({ routeId: '/a/[acct]/s/[space]/new', pathname: '/a/acme/s/engineering/new', org, space })).toEqual([
      { label: 'Acme', href: '/a/acme' },
      { label: 'Engineering', href: '/a/acme/s/engineering' },
      { label: 'New docket' },
    ])
    expect(crumbsFor({ routeId: '/a/[acct]/spaces/new', pathname: '/a/acme/spaces/new', org }).at(-1)).toEqual({ label: 'New space' })
  })

  it('name pages outside a casebook', () => {
    expect(crumbsFor({ routeId: '/start', pathname: '/start' })).toEqual([{ label: 'Create your account' }])
    expect(crumbsFor({ routeId: null, pathname: '/nowhere' })).toEqual([{ label: 'Docket Cloud' }])
  })
})
