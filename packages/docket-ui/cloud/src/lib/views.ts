// SPDX-License-Identifier: AGPL-3.0-only
import { CAPABILITIES, type Capability, type ResponseBody } from '@docket/api'
import { summarise } from '@docket/platform-tenancy/roles'

/**
 * The API's answers (`@docket/api`, snake_case on the wire) as the server's
 * components take them: the app shell, the docket's frame and the access
 * components read the same data on the server's pages and here.
 */

type Me = ResponseBody<'me.get'>
type Navigation = ResponseBody<'accounts.navigation'>
type Docket = ResponseBody<'dockets.get'>
type Summary = ResponseBody<'dockets.summary'>
type Grant = ResponseBody<'grants.create'>
type Place = Grant['place']

/** Capability by capability, whether `caps` holds it. */
export const capabilityMap = (caps: readonly Capability[]) => Object.fromEntries(CAPABILITIES.map((cap) => [cap, caps.includes(cap)])) as Record<Capability, boolean>

/** The signed-in user and their accounts, as the shell takes them. */
export function sessionOf(me: Me) {
  return {
    user: { login: me.user.login, name: me.user.name, avatarUrl: null, allowlisted: me.allowlisted, platformAdmin: me.platform_admin },
    orgs: me.accounts.map((account) => ({ slug: account.slug, name: account.name, role: account.owner ? 'owner' : account.guest ? 'guest' : 'member' })),
    csrf: me.csrf,
  }
}

/** An account's sidebar, as the shell takes it. */
export function accountOf(navigation: Navigation) {
  return {
    org: navigation.account,
    role: navigation.role,
    permissions: capabilityMap(navigation.caps),
    owner: navigation.owner,
    accountAdmin: navigation.account_admin,
    managesAccess: navigation.manages_access,
    managesSystemAccounts: navigation.manages_system_accounts,
    workspaces: navigation.dockets.map((docket) => ({ slug: docket.slug, name: docket.name })),
    spaces: navigation.spaces,
    createsDockets: navigation.spaces.some((space) => space.create),
    createsSpaces: navigation.creates_spaces,
    dockets: navigation.dockets.map((docket) => ({ slug: docket.slug, name: docket.name, spaceId: docket.space_id, docketNo: docket.number, open: docket.open })),
    tokenNotices: navigation.token_notices,
    ai: { spentUsd: navigation.ai.spent_usd, capUsd: navigation.ai.cap_usd, fraction: navigation.ai.fraction, warned: navigation.ai.warned },
  }
}

/** A docket's header, as the docket's frame takes it. */
export function docketOf(docket: Docket, summary: Summary) {
  return {
    here: capabilityMap(docket.caps),
    workspace: {
      id: docket.id,
      slug: docket.slug,
      name: docket.name,
      space: docket.space,
      openedAt: docket.created_at,
      documents: summary.documents,
      drafts: summary.drafts,
      head: summary.schema
        ? { number: summary.schema.version, publishedAt: summary.schema.published_at, publishedBy: summary.schema.published_by, message: summary.schema.message }
        : null,
    },
  }
}

/** How a place reads beside a grant: "Payments (docket)", "Acme (the whole account)". */
export function placeLabel(place: Place): string {
  return place.kind === 'account' ? `${place.name} (the whole account)` : `${place.name} (${place.kind})`
}

/** A grant as the access components take it. */
export function grantRow(grant: Grant) {
  const who = grant.who
  return {
    id: grant.id,
    who:
      who.kind === 'everyone'
        ? { kind: 'everyone' as const, id: null, login: null, name: who.name, userKind: null, guest: false }
        : { kind: 'user' as const, id: who.id, login: who.login, name: who.name, userKind: who.kind === 'system' ? ('service' as const) : ('human' as const), guest: who.guest },
    place: { key: grant.place.ref, kind: grant.place.kind, label: placeLabel(grant.place) },
    role: grant.role,
    caps: grant.caps,
    label: grant.label,
    grantedBy: grant.granted_by,
    mayChange: grant.may_change,
  }
}
export type GrantRow = ReturnType<typeof grantRow>

/** Who a grant reads as in a change's message: a member's login, or everyone. */
const whoOf = (grant: Pick<Grant, 'who'>) => (grant.who.kind === 'everyone' ? 'everyone' : grant.who.login)

/** What giving or changing a grant came to, in the words the server's pages use. */
export const givenMessage = (grant: Grant) => `${whoOf(grant)} now has ${grant.label} on ${placeLabel(grant.place)}.`

/** What taking a grant away came to. */
export const removedMessage = (row: GrantRow) => `${row.who.login ?? 'everyone'} no longer has ${row.label} on ${row.place.label}.`

/** What a caller's access on a place reads as, in a word: Owner, Admin, Can write... */
export const accessSummary = (owner: boolean, caps: readonly Capability[]) => (owner ? 'Owner' : summarise(caps).label)

/**
 * A role with capabilities ticked under it, as a grant's role and its adjustments: what is ticked beyond the
 * role is added, what the role has but is not ticked is removed. `ticked` null: the role as it is.
 */
export function adjustment(role: { caps: readonly string[] }, ticked: readonly string[] | null): { add: Capability[]; remove: Capability[] } {
  if (ticked === null) return { add: [], remove: [] }
  return {
    add: CAPABILITIES.filter((cap) => ticked.includes(cap) && !role.caps.includes(cap)),
    remove: CAPABILITIES.filter((cap) => role.caps.includes(cap) && !ticked.includes(cap)),
  }
}
