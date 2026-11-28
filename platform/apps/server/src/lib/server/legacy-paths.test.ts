// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { legacyPath, legacyRedirect } from './legacy-paths'

describe('legacyPath', () => {
  it('moves an account page from /o/{org} to /a/{acct}', () => {
    expect(legacyPath('/o/acme')).toBe('/a/acme')
    expect(legacyPath('/o/acme/')).toBe('/a/acme/')
    expect(legacyPath('/o/acme/members')).toBe('/a/acme/members')
    expect(legacyPath('/o/acme/ask')).toBe('/a/acme/ask')
    expect(legacyPath('/o/acme/ask/stream')).toBe('/a/acme/ask/stream')
    expect(legacyPath('/o/acme/settings/system-accounts/sa_1')).toBe('/a/acme/settings/system-accounts/sa_1')
    expect(legacyPath('/o/acme/s/engineering/new')).toBe('/a/acme/s/engineering/new')
    expect(legacyPath('/o/acme/spaces/new')).toBe('/a/acme/spaces/new')
  })

  it('moves a docket page from /o/{org}/w/{ws} to /a/{acct}/d/{docket}', () => {
    expect(legacyPath('/o/acme/w/payments')).toBe('/a/acme/d/payments')
    expect(legacyPath('/o/acme/w/payments/overview')).toBe('/a/acme/d/payments/overview')
    expect(legacyPath('/o/acme/w/payments/documents/notes/a.md')).toBe('/a/acme/d/payments/documents/notes/a.md')
    expect(legacyPath('/o/acme/w/payments/graph/search')).toBe('/a/acme/d/payments/graph/search')
    // Only the docket segment moves: a docket whose slug is "w" keeps it.
    expect(legacyPath('/o/acme/w/w/ask')).toBe('/a/acme/d/w/ask')
  })

  it("moves New docket's drafts from /workspaces/new to /dockets/new", () => {
    expect(legacyPath('/o/acme/workspaces/new')).toBe('/a/acme/dockets/new')
    expect(legacyPath('/o/acme/workspaces/new/draft/d1/check')).toBe('/a/acme/dockets/new/draft/d1/check')
  })

  it('leaves every other address alone: the CLI and org admin APIs, MCP, the new pages', () => {
    for (const path of [
      '/',
      '/a/acme',
      '/a/acme/d/payments/overview',
      '/api/o/acme/w/payments/documents',
      '/api/admin/o/acme/databases',
      '/mcp/acme',
      '/mcp/acme/payments',
      '/orgs',
      '/oauth/consent/x',
      '/o',
      '/other/o/acme',
    ]) {
      expect(legacyPath(path), path).toBeNull()
    }
  })
})

describe('legacyRedirect', () => {
  it('answers 308 with the new address and the query, so a form posts again to the new one', () => {
    const response = legacyRedirect(new URL('https://docket.example/o/acme/w/payments/graph?focus=service.orders'))
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('/a/acme/d/payments/graph?focus=service.orders')
    expect(legacyRedirect(new URL('https://docket.example/o/acme/members?/invite'))?.headers.get('location')).toBe('/a/acme/members?/invite')
  })

  it('answers nothing for an address that did not move', () => {
    expect(legacyRedirect(new URL('https://docket.example/api/o/acme/w/payments/me'))).toBeNull()
  })
})
