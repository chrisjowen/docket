// SPDX-License-Identifier: AGPL-3.0-only
import { operation } from '@docket/api'
import { describe, expect, it } from 'vitest'

import { accessSummary, accountOf, adjustment, docketOf, givenMessage, grantRow, placeLabel, removedMessage, sessionOf } from './views'

const grant = {
  id: 'g1',
  who: { kind: 'user' as const, id: 'u2', login: 'sam', name: 'Sam', guest: false },
  place: { kind: 'docket' as const, id: 'w1', slug: 'payments', name: 'Payments', ref: 'docket:payments' },
  role: { id: 'writer', name: 'Writer' },
  add: ['publish' as const],
  remove: [],
  caps: ['read' as const, 'write' as const, 'propose' as const, 'publish' as const],
  label: 'Writer + Publish ontology changes',
  granted_by: 'alice',
  created_at: '2026-11-27T10:00:00.000Z',
  may_change: true,
}

describe("the API's answers as the server's components take them", () => {
  it('reads me.get as the shell’s session', () => {
    const me = {
      user: { id: 'u1', login: 'alice', name: 'Alice', kind: 'human' as const },
      via: 'session' as const,
      csrf: 'token',
      credential: null,
      allowlisted: true,
      platform_admin: false,
      accounts: [
        { id: 'o1', slug: 'acme', name: 'Acme', owner: true, guest: false },
        { id: 'o2', slug: 'side', name: 'Side', owner: false, guest: true },
      ],
    }
    expect(operation('me.get').response?.safeParse(me).success).toBe(true)
    expect(sessionOf(me)).toEqual({
      user: { login: 'alice', name: 'Alice', avatarUrl: null, allowlisted: true, platformAdmin: false },
      orgs: [
        { slug: 'acme', name: 'Acme', role: 'owner' },
        { slug: 'side', name: 'Side', role: 'guest' },
      ],
      csrf: 'token',
    })
  })

  it('reads accounts.navigation as the sidebar', () => {
    const navigation = {
      account: { slug: 'acme', name: 'Acme' },
      role: 'Writer on General',
      caps: ['read' as const],
      owner: false,
      account_admin: false,
      manages_access: true,
      manages_system_accounts: false,
      creates_spaces: false,
      spaces: [{ id: 'general', slug: 'general', name: 'General', general: true, create: true }],
      dockets: [{ slug: 'payments', name: 'Payments', space_id: 'general', number: 'PAY-26-0001', open: true }],
      token_notices: { expiring: 1, expired: 0 },
      ai: { spent_usd: 1, cap_usd: 20, fraction: 0.05, warned: false },
    }
    expect(operation('accounts.navigation').response?.safeParse(navigation).success).toBe(true)
    const shell = accountOf(navigation)
    expect(shell.permissions).toMatchObject({ read: true, write: false })
    expect(shell.dockets).toEqual([{ slug: 'payments', name: 'Payments', spaceId: 'general', docketNo: 'PAY-26-0001', open: true }])
    expect(shell).toMatchObject({ createsDockets: true, managesAccess: true, ai: { spentUsd: 1, capUsd: 20 } })
  })

  it('reads dockets.get and dockets.summary as the docket’s header', () => {
    const docket = {
      id: 'w1',
      slug: 'payments',
      name: 'Payments',
      space: { id: 'general', slug: 'general', name: 'General' },
      caps: ['read' as const],
      created_at: '2026-11-01T00:00:00.000Z',
      mcp_url: 'https://docket.example/mcp/acme/payments',
    }
    const summary = { docket: 'payments', documents: 3, drafts: 1, schema: { version: 2, published_at: null, published_by: '@alice', message: null } }
    expect(operation('dockets.summary').response?.safeParse(summary).success).toBe(true)
    expect(docketOf(docket, summary)).toMatchObject({
      here: { read: true, write: false },
      workspace: { slug: 'payments', openedAt: docket.created_at, documents: 3, drafts: 1, head: { number: 2, publishedBy: '@alice' }, space: { slug: 'general' } },
    })
  })

  it('reads a grant as the access components’ row, and says what a change did as the server’s pages do', () => {
    expect(grantRow(grant)).toMatchObject({
      who: { kind: 'user', id: 'u2', login: 'sam', userKind: 'human' },
      place: { key: 'docket:payments', label: 'Payments (docket)' },
      grantedBy: 'alice',
      mayChange: true,
    })
    expect(grantRow({ ...grant, who: { kind: 'everyone', name: 'Everyone at Acme' } }).who).toMatchObject({ kind: 'everyone', login: null })
    expect(placeLabel({ kind: 'account', id: null, slug: null, name: 'Acme', ref: 'account' })).toBe('Acme (the whole account)')
    expect(givenMessage(grant)).toBe('sam now has Writer + Publish ontology changes on Payments (docket).')
    expect(removedMessage(grantRow(grant))).toBe('sam no longer has Writer + Publish ontology changes on Payments (docket).')
  })

  it('turns the capabilities ticked under a role into what the grant adds and removes', () => {
    const writer = { caps: ['read', 'write', 'propose'] }
    expect(adjustment(writer, null)).toEqual({ add: [], remove: [] })
    expect(adjustment(writer, ['read', 'write', 'propose', 'publish'])).toEqual({ add: ['publish'], remove: [] })
    expect(adjustment(writer, ['read'])).toEqual({ add: [], remove: ['write', 'propose'] })
    expect(accessSummary(true, ['read'])).toBe('Owner')
    expect(accessSummary(false, ['read', 'write', 'propose'])).toBe('Can write')
  })
})
