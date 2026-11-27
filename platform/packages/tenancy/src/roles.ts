// SPDX-License-Identifier: AGPL-3.0-only

// Access is a role on a place (tenancy v2 §3.1). A capability is one thing
// someone may do; a role is a named bundle of them; a grant gives a user, a
// system account or everyone in the account one role on one place - the
// whole account or one docket - optionally adding or removing single
// capabilities for that grant alone. What a principal may do on a place is
// the union of every grant whose place covers it. Nothing subtracts across
// grants. This module is the one resolver every surface uses: the web app's
// buttons and requests, the JSON API, MCP, the CLI's API and OAuth consent.

/** The capabilities, the only permission vocabulary there is, in the order the UI lists them. */
export const CAPABILITIES = [
  'read',
  'write',
  'propose',
  'publish',
  'decide',
  'create',
  'access',
  'system',
  'tokens',
  'settings',
  'delete',
  'audit',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value)
}

export interface CapabilityInfo {
  label: string
  help: string
  group: 'Content' | 'Manage'
}

/** How each capability reads in the UI. */
export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = {
  read: { label: 'Read and ask', help: 'Open dockets, search, chat, see activity, make your own tokens', group: 'Content' },
  write: { label: 'Write knowledge', help: 'Add, update and retire records and evidence (UI, MCP, CLI push)', group: 'Content' },
  propose: { label: 'Propose ontology changes', help: 'File an ontology draft for someone else to publish', group: 'Content' },
  publish: { label: 'Publish ontology changes', help: 'Change the ontology directly, in the UI or over MCP', group: 'Content' },
  decide: { label: 'Decide proposals', help: 'Accept or reject a supersede proposal whatever its score', group: 'Content' },
  create: { label: 'Create dockets', help: 'Make new dockets (held on the account)', group: 'Manage' },
  access: { label: 'Manage access', help: "Give and remove users' and system accounts' access here; invite users", group: 'Manage' },
  system: { label: 'Manage system accounts', help: 'Create system accounts that reach here; issue and revoke their tokens', group: 'Manage' },
  tokens: { label: 'Manage tokens', help: "See and revoke anyone's tokens and AI connections here", group: 'Manage' },
  settings: { label: 'Change settings', help: 'Background agents, projections, repos, trust, templates', group: 'Manage' },
  delete: { label: 'Delete', help: 'Delete dockets and everything in them', group: 'Manage' },
  audit: { label: 'See audit and usage', help: 'Who did what, and what it cost', group: 'Manage' },
}

/** What reaches a docket's content; a role without any of them manages without reading. */
export const CONTENT_CAPABILITIES: readonly Capability[] = ['read', 'write', 'propose', 'publish', 'decide']

/** A role: a named bundle of capabilities. Reader, Writer and Admin are built in and fixed; an account adds its own. */
export interface Role {
  id: string
  name: string
  description: string | null
  caps: readonly Capability[]
  builtin: boolean
}

export const BUILTIN_ROLES: readonly Role[] = [
  { id: 'reader', name: 'Reader', description: 'Reads and asks', caps: ['read'], builtin: true },
  { id: 'writer', name: 'Writer', description: 'Reads, writes knowledge and proposes ontology changes', caps: ['read', 'write', 'propose'], builtin: true },
  { id: 'admin', name: 'Admin', description: 'Every capability', caps: CAPABILITIES, builtin: true },
]
export type BuiltinRoleId = 'reader' | 'writer' | 'admin'

export function builtinRole(id: BuiltinRoleId): Role {
  return BUILTIN_ROLES.find((role) => role.id === id) as Role
}

/** A place a grant is on: the whole account, or one docket (a workspace, by id). Spaces come next (tenancy v2 phase 3). */
export type Place = { kind: 'account' } | { kind: 'docket'; id: string }

export const ACCOUNT: Place = { kind: 'account' }
export const docketPlace = (id: string): Place => ({ kind: 'docket', id })

/** Whether a grant on `on` reaches `place`: the account covers everything, a docket only itself. */
export function covers(on: Place, place: Place): boolean {
  if (on.kind === 'account') return true
  return place.kind === 'docket' && place.id === on.id
}

export function samePlace(a: Place, b: Place): boolean {
  return a.kind === b.kind && (a.kind === 'account' || a.id === (b as { id: string }).id)
}

/** Who a grant is for: one user or system account, or everyone in the account (people who are not guests). */
export type Grantee = { kind: 'user'; id: string } | { kind: 'everyone' }

export interface Grant {
  id: string
  who: Grantee
  place: Place
  role: Role
  /** Capabilities this grant adds to its role, for this grantee alone. */
  add: readonly Capability[]
  /** Capabilities this grant removes from its role, for this grantee alone. */
  remove: readonly Capability[]
}

/** What one grant gives: its role's capabilities, plus its additions, minus its removals. */
export function grantCaps(grant: Pick<Grant, 'role' | 'add' | 'remove'>): Capability[] {
  const caps = new Set<Capability>([...grant.role.caps, ...grant.add])
  for (const cap of grant.remove) caps.delete(cap)
  return CAPABILITIES.filter((cap) => caps.has(cap))
}

/**
 * Everything that decides one principal's access in one account: whether
 * they own it, whether they are a guest, and every grant that applies to them
 * (their own, and those for everyone when they are a person who is not a guest).
 */
export interface Access {
  userId: string
  kind: 'human' | 'service'
  /** Owns the account: Admin on all of it, fixed, and the only one who may administer it (billing, AI caps, ownership). */
  owner: boolean
  /** Sees only what they are given: not in "everyone", not the user list, not the dockets they have nothing on. */
  guest: boolean
  grants: readonly Grant[]
}

/** Whether a grant applies to a principal: their own, or one for everyone when they are a person who is not a guest. */
export function appliesTo(grant: Pick<Grant, 'who'>, principal: Pick<Access, 'userId' | 'kind' | 'guest'>): boolean {
  if (grant.who.kind === 'user') return grant.who.id === principal.userId
  return principal.kind === 'human' && !principal.guest
}

/** What a principal may do on a place: the union of every grant that covers it. An owner may do everything. */
export function capsAt(access: Access | null, place: Place): ReadonlySet<Capability> {
  if (!access) return new Set()
  if (access.owner) return new Set(CAPABILITIES)
  const caps = new Set<Capability>()
  for (const grant of access.grants) {
    if (covers(grant.place, place)) for (const cap of grantCaps(grant)) caps.add(cap)
  }
  return caps
}

/** Whether a principal holds `cap` on the place, or anywhere at all with `place` omitted. */
export function can(access: Access | null, cap: Capability, place?: Place): boolean {
  if (!access) return false
  if (access.owner) return true
  if (place) return capsAt(access, place).has(cap)
  return access.grants.some((grant) => grantCaps(grant).includes(cap))
}

/** The grants that make up a principal's access to a place: why they can do what they can there. */
export function because(access: Access, place: Place): Grant[] {
  return access.grants.filter((grant) => covers(grant.place, place))
}

/**
 * Whether a principal sees that a docket exists (in lists, or as 403 rather
 * than 404): everyone but a guest sees them all; a guest only those they hold
 * something on.
 */
export function seesDocket(access: Access | null, docketId: string): boolean {
  if (!access) return false
  return !access.guest || capsAt(access, docketPlace(docketId)).size > 0
}

/** Whether a principal holds every capability on the account: the account's admins and owners. */
export function isAccountAdmin(access: Access | null): boolean {
  if (!access) return false
  const caps = capsAt(access, ACCOUNT)
  return CAPABILITIES.every((cap) => caps.has(cap))
}

/** One word for a set of capabilities, and anything beyond that word's usual bundle. */
export function summarise(caps: Iterable<Capability>): { level: 'admin' | 'write' | 'read' | 'manage' | null; label: string; extra: Capability[] } {
  const held = new Set(caps)
  if (held.size === 0) return { level: null, label: 'No access', extra: [] }
  if (CAPABILITIES.every((cap) => held.has(cap))) return { level: 'admin', label: 'Admin', extra: [] }
  const level = held.has('write') ? 'write' : held.has('read') ? 'read' : 'manage'
  const usual: readonly Capability[] = level === 'write' ? builtinRole('writer').caps : level === 'read' ? builtinRole('reader').caps : []
  const label = { write: 'Can write', read: 'Can read', manage: 'Manages, reads nothing' }[level]
  return { level, label, extra: CAPABILITIES.filter((cap) => held.has(cap) && !usual.includes(cap)) }
}

/** "Writer + Publish ontology changes", "Admin, without content". */
export function grantRoleLabel(grant: Pick<Grant, 'role' | 'add' | 'remove'>): string {
  let label = grant.role.name
  if (grant.remove.length && CONTENT_CAPABILITIES.every((cap) => grant.remove.includes(cap))) label += ', without content'
  else label += grant.remove.map((cap) => ` − ${CAPABILITY_INFO[cap].label}`).join('')
  label += grant.add.map((cap) => ` + ${CAPABILITY_INFO[cap].label}`).join('')
  return label
}

/**
 * Whether `actor` may give, change or take away a grant with `caps` on
 * `place` for a grantee of `kind`. They manage access there (or, for a system
 * account, manage system accounts there), and the grant gives nothing they
 * do not hold there themselves: no one widens anyone past their own reach.
 */
export function mayGrant(actor: Access | null, place: Place, caps: Iterable<Capability>, grantee: 'human' | 'service' | 'everyone'): boolean {
  if (!actor) return false
  if (actor.owner) return true
  const held = capsAt(actor, place)
  const manages = held.has('access') || (grantee === 'service' && held.has('system'))
  if (!manages) return false
  for (const cap of caps) if (!held.has(cap)) return false
  return true
}

/** Whether `actor` may make, change or delete one of the account's own roles: an admin on the whole account. */
export function mayEditRoles(actor: Access | null): boolean {
  return isAccountAdmin(actor)
}
