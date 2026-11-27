// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import {
  ACCOUNT,
  BUILTIN_ROLES,
  CAPABILITIES,
  because,
  builtinRole,
  can,
  capsAt,
  docketPlace,
  grantCaps,
  grantRoleLabel,
  isAccountAdmin,
  mayEditRoles,
  mayGrant,
  seesDocket,
  summarise,
  type Access,
  type Capability,
  type Grant,
  type Grantee,
  type Place,
  type Role,
} from './roles.js'

const reader = builtinRole('reader')
const writer = builtinRole('writer')
const admin = builtinRole('admin')
const provisioner: Role = { id: 'r_prov', name: 'Provisioner', description: null, caps: ['create', 'access', 'audit'], builtin: false }

let seq = 0
const grant = (who: Grantee, place: Place, role: Role, adjust: { add?: Capability[]; remove?: Capability[] } = {}): Grant => ({
  id: `g${(seq += 1)}`,
  who,
  place,
  role,
  add: adjust.add ?? [],
  remove: adjust.remove ?? [],
})
const user = (id: string) => ({ kind: 'user', id }) as const
const person = (userId: string, grants: Grant[], flags: { owner?: boolean; guest?: boolean } = {}): Access => ({
  userId,
  kind: 'human',
  owner: flags.owner ?? false,
  guest: flags.guest ?? false,
  grants,
})

const payments = docketPlace('payments')
const platform = docketPlace('platform')

describe('the built-in roles', () => {
  it('are Reader, Writer and Admin, each a superset of the one before', () => {
    expect(BUILTIN_ROLES.map((role) => role.id)).toEqual(['reader', 'writer', 'admin'])
    expect(reader.caps).toEqual(['read'])
    expect(writer.caps).toEqual(['read', 'write', 'propose'])
    expect(admin.caps).toEqual(CAPABILITIES)
  })
})

describe('grantCaps', () => {
  it("is the role's capabilities plus the grant's additions minus its removals", () => {
    expect(grantCaps({ role: writer, add: ['publish'], remove: [] })).toEqual(['read', 'write', 'propose', 'publish'])
    expect(grantCaps({ role: admin, add: [], remove: ['read', 'write', 'propose', 'publish', 'decide'] })).toEqual([
      'create',
      'access',
      'system',
      'tokens',
      'settings',
      'delete',
      'audit',
    ])
  })
})

describe('capsAt', () => {
  // The worked example: Sam is Reader on the account, Writer + Publish on Payments.
  const sam = person('sam', [grant(user('sam'), ACCOUNT, reader), grant(user('sam'), payments, writer, { add: ['publish'] })])

  it('adds up every grant whose place covers the place asked about', () => {
    expect([...capsAt(sam, payments)]).toEqual(['read', 'write', 'propose', 'publish'])
    expect([...capsAt(sam, platform)]).toEqual(['read'])
    expect([...capsAt(sam, ACCOUNT)]).toEqual(['read'])
  })

  it('never subtracts across grants: a removal touches only its own grant', () => {
    const both = person('x', [grant(user('x'), ACCOUNT, writer), grant(user('x'), payments, writer, { remove: ['write'] })])
    expect(capsAt(both, payments).has('write')).toBe(true)
  })

  it('gives an owner everything everywhere, and nobody (null) nothing', () => {
    expect(capsAt(person('o', [], { owner: true }), payments).size).toBe(CAPABILITIES.length)
    expect(capsAt(null, payments).size).toBe(0)
  })

  it('answers can() on a place, or anywhere when no place is named', () => {
    expect(can(sam, 'publish', payments)).toBe(true)
    expect(can(sam, 'publish', platform)).toBe(false)
    expect(can(sam, 'publish')).toBe(true)
    expect(can(sam, 'delete')).toBe(false)
  })

  it('lists the grants that explain access to a place', () => {
    expect(because(sam, payments).map((each) => each.place.kind)).toEqual(['account', 'docket'])
    expect(because(sam, platform)).toHaveLength(1)
  })
})

describe('seesDocket', () => {
  it('shows every docket to a member who is not a guest, and a guest only what they hold', () => {
    const member = person('m', [])
    const guest = person('g', [grant(user('g'), payments, reader)], { guest: true })
    expect(seesDocket(member, 'platform')).toBe(true)
    expect(seesDocket(guest, 'payments')).toBe(true)
    expect(seesDocket(guest, 'platform')).toBe(false)
  })
})

describe('summarise and labels', () => {
  it('names a set of capabilities by its nearest built-in role, with what goes beyond it', () => {
    expect(summarise([])).toEqual({ level: null, label: 'No access', extra: [] })
    expect(summarise(CAPABILITIES).label).toBe('Admin')
    expect(summarise(['read', 'write', 'propose', 'publish'])).toEqual({ level: 'write', label: 'Can write', extra: ['publish'] })
    expect(summarise(['create', 'access', 'audit']).label).toBe('Manages, reads nothing')
  })

  it('reads a grant as its role, its additions and its removals', () => {
    expect(grantRoleLabel({ role: writer, add: ['publish'], remove: [] })).toBe('Writer + Publish ontology changes')
    expect(grantRoleLabel({ role: admin, add: [], remove: ['read', 'write', 'propose', 'publish', 'decide'] })).toBe('Admin, without content')
  })
})

describe('mayGrant', () => {
  const lead = person('lead', [grant(user('lead'), payments, admin)])
  const writerEverywhere = person('w', [grant(user('w'), ACCOUNT, writer)])

  it('lets someone who manages access on a place give what they hold there', () => {
    expect(mayGrant(lead, payments, writer.caps, 'human')).toBe(true)
    expect(mayGrant(lead, payments, admin.caps, 'human')).toBe(true)
  })

  it('refuses a place they do not manage, and anything beyond their own reach', () => {
    expect(mayGrant(lead, platform, reader.caps, 'human')).toBe(false)
    expect(mayGrant(lead, ACCOUNT, reader.caps, 'human')).toBe(false)
    expect(mayGrant(writerEverywhere, payments, reader.caps, 'human')).toBe(false)
    const custom = person('c', [grant(user('c'), ACCOUNT, provisioner)])
    expect(mayGrant(custom, payments, reader.caps, 'human')).toBe(false)
    expect(mayGrant(custom, payments, ['access'], 'human')).toBe(true)
  })

  it('lets managing system accounts give a system account access, not a person', () => {
    const systems = person('s', [grant(user('s'), payments, reader, { add: ['system'] })])
    expect(mayGrant(systems, payments, reader.caps, 'service')).toBe(true)
    expect(mayGrant(systems, payments, reader.caps, 'human')).toBe(false)
  })

  it('lets an owner give anything, and only account admins edit roles', () => {
    const owner = person('o', [], { owner: true })
    expect(mayGrant(owner, ACCOUNT, admin.caps, 'everyone')).toBe(true)
    expect(isAccountAdmin(person('a', [grant(user('a'), ACCOUNT, admin)]))).toBe(true)
    expect(mayEditRoles(lead)).toBe(false)
    expect(mayEditRoles(owner)).toBe(true)
  })
})
