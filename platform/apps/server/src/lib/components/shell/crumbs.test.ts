// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { crumbsFor } from './crumbs'

const org = { slug: 'acme', name: 'Acme' }
const workspace = { slug: 'platform', name: 'Platform' }

describe('breadcrumbs', () => {
  it('name the casebook on its own page, and lead back to it from an org page', () => {
    expect(crumbsFor({ routeId: '/o/[org]', pathname: '/o/acme', org })).toEqual([{ label: 'Acme casebook' }])
    expect(crumbsFor({ routeId: '/o/[org]/members', pathname: '/o/acme/members', org })).toEqual([
      { label: 'Acme casebook', href: '/o/acme' },
      { label: 'Users' },
    ])
  })

  it("end on the docket on its overview, and on the section elsewhere", () => {
    expect(crumbsFor({ routeId: '/o/[org]/w/[ws]/overview', pathname: '/o/acme/w/platform/overview', org, workspace })).toEqual([
      { label: 'Acme', href: '/o/acme' },
      { label: 'Platform' },
    ])
    expect(crumbsFor({ routeId: '/o/[org]/w/[ws]/graph', pathname: '/o/acme/w/platform/graph', org, workspace })).toEqual([
      { label: 'Acme', href: '/o/acme' },
      { label: 'Platform', href: '/o/acme/w/platform/overview' },
      { label: 'Record' },
    ])
  })

  it("link a nested page's section", () => {
    expect(crumbsFor({ routeId: '/o/[org]/w/[ws]/ontology/history', pathname: '/o/acme/w/platform/ontology/history', org, workspace }).at(-1)).toEqual({
      label: 'Schema',
      href: '/o/acme/w/platform/ontology',
    })
  })

  it('name pages outside a casebook', () => {
    expect(crumbsFor({ routeId: '/orgs/new', pathname: '/orgs/new' })).toEqual([{ label: 'New organisation' }])
    expect(crumbsFor({ routeId: null, pathname: '/nowhere' })).toEqual([{ label: 'Docket Cloud' }])
  })
})
