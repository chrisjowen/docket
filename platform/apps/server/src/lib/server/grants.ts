// SPDX-License-Identifier: AGPL-3.0-only
import { listSpaces, listWorkspaces } from '@docket/platform-canonical-store'
import {
  ACCOUNT,
  CAPABILITIES,
  TenancyError,
  docketPlace,
  grantCaps,
  grantRoleLabel,
  isCapability,
  listGrants,
  listRoles,
  mayGrant,
  placeKey,
  removeGrant,
  setGrant,
  spacePlace,
  type Access,
  type Capability,
  type GrantView,
  type Grantee,
  type Place,
  type Role,
  type Tx,
} from '@docket/platform-tenancy'
import { error, fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit'

import { orgAccess, recordAudit, requireUser, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * Access is a role on a place (tenancy v2 §3.1), given, adjusted and taken
 * away the same way from a docket's or a space's access page, the Users page
 * and a system account's page. A place travels in forms as `account`,
 * `space:<id>` or `docket:<id>` (`placeKey`).
 */

export { placeKey }

/** The account's spaces and dockets, by id, with their names: what a place reads as. */
export interface PlaceNames {
  spaces: Map<string, { slug: string; name: string; general: boolean }>
  dockets: Map<string, { slug: string; name: string; spaceId: string }>
}

export async function placeNames(orgId: string): Promise<PlaceNames> {
  const { spaces, workspaces } = await getRuntime().router.withTenant(orgId, async (tx) => ({ spaces: await listSpaces(tx), workspaces: await listWorkspaces(tx) }))
  return {
    spaces: new Map(spaces.map((space) => [space.id, { slug: space.slug, name: space.name, general: space.general }])),
    dockets: new Map(workspaces.map((workspace) => [workspace.id, { slug: workspace.slug, name: workspace.name, spaceId: workspace.spaceId }])),
  }
}

/** A place a form names, if it is the account or one of its spaces or dockets. */
export function placeOf(value: unknown, names: PlaceNames): Place | null {
  if (value === 'account') return ACCOUNT
  if (typeof value !== 'string') return null
  if (value.startsWith('space:') && names.spaces.has(value.slice(6))) return spacePlace(value.slice(6))
  if (value.startsWith('docket:') && names.dockets.has(value.slice(7))) return docketPlace(value.slice(7))
  return null
}

export function placeLabel(place: Place, names: PlaceNames, orgName: string): string {
  if (place.kind === 'account') return `${orgName} (the whole account)`
  if (place.kind === 'space') return `${names.spaces.get(place.id)?.name ?? 'a deleted space'} (space)`
  return `${names.dockets.get(place.id)?.name ?? 'a deleted docket'} (docket)`
}

/**
 * The places where the actor may give access: the account, every space and
 * every docket where they manage access (or system accounts), each space
 * followed by its dockets.
 */
export function placesToGive(access: OrgAccess, names: PlaceNames, grantee: 'human' | 'service' | 'everyone' = 'human'): { key: string; label: string }[] {
  const manages = (place: Place) => {
    const caps = access.capsAt(place)
    return caps.has('access') || (grantee === 'service' && caps.has('system'))
  }
  const places: Place[] = [ACCOUNT]
  for (const spaceId of names.spaces.keys()) {
    places.push(spacePlace(spaceId))
    for (const [docketId, docket] of names.dockets) if (docket.spaceId === spaceId) places.push(docketPlace(docketId))
  }
  return places.filter(manages).map((place) => ({ key: placeKey(place), label: placeLabel(place, names, access.org.name) }))
}

/** A role as the forms offer it: its name, what it gives, and whether it is one of the account's own. */
export const roleView = (role: Role & { grants?: number }) => ({
  id: role.id,
  name: role.name,
  description: role.description,
  caps: [...role.caps],
  builtin: role.builtin,
  grants: role.grants ?? 0,
})

/** A grant as a page shows it, and whether the viewer may change it. */
export function grantView(grant: GrantView, viewer: Access, names: PlaceNames, orgName: string) {
  const caps = grantCaps(grant)
  const kind = grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.userKind
  return {
    id: grant.id,
    who:
      grant.grantee.kind === 'everyone'
        ? { kind: 'everyone' as const, id: null, login: null, name: `Everyone at ${orgName}`, userKind: null, guest: false }
        : { kind: 'user' as const, id: grant.grantee.id, login: grant.grantee.login, name: grant.grantee.name, userKind: grant.grantee.userKind, guest: grant.grantee.guest },
    place: { key: placeKey(grant.place), kind: grant.place.kind, label: placeLabel(grant.place, names, orgName) },
    role: { id: grant.role.id, name: grant.role.name },
    add: [...grant.add],
    remove: [...grant.remove],
    caps,
    label: grantRoleLabel(grant),
    grantedBy: grant.grantedByLogin,
    createdAt: grant.createdAt.toISOString(),
    mayChange: mayGrant(viewer, grant.place, caps, kind),
  }
}
export type GrantRow = ReturnType<typeof grantView>

/** The account's roles, for the forms. */
export async function rolesFor(orgId: string) {
  return (await getRuntime().router.withPlatform((tx) => listRoles(tx, orgId))).map(roleView)
}

/** The capabilities a form ticked. */
export function capsFrom(form: FormData, field = 'cap'): Capability[] {
  const ticked = new Set(form.getAll(field).map(String))
  return CAPABILITIES.filter((cap) => ticked.has(cap) && isCapability(cap))
}

/**
 * The role a form chose and the capabilities ticked under it, as a grant's
 * role and its adjustments: what is ticked beyond the role is added, what the
 * role has but is not ticked is removed. With no capability list at all, the
 * role as it is.
 */
export function adjustmentOf(form: FormData, roles: readonly { id: string; caps: readonly string[] }[]) {
  const roleId = String(form.get('role') ?? '')
  const role = roles.find((each) => each.id === roleId)
  if (!role) throw new TenancyError('invalid', 'Choose a role.')
  if (!form.has('adjusted')) return { roleId, add: [], remove: [] }
  const caps = capsFrom(form)
  return {
    roleId,
    add: caps.filter((cap) => !role.caps.includes(cap)),
    remove: role.caps.filter((cap): cap is Capability => isCapability(cap) && !caps.includes(cap)),
  }
}

/** The grantee a form names: a member by id, or everyone. */
export function granteeOf(form: FormData): Grantee {
  const who = String(form.get('who') ?? '')
  if (who === 'everyone') return { kind: 'everyone' }
  if (!who) throw new TenancyError('invalid', 'Choose who gets access.')
  return { kind: 'user', id: who }
}

type Change = {
  action: string
  target: string[]
  args?: unknown
  flash: string
  inOrg?: (tx: Tx) => Promise<void>
  /** Runs once the change is saved (an invite's email): its flash replaces the change's, and an invite's link joins the page's data. */
  after?: () => Promise<{ flash?: string; invited?: Invited }>
}

/** A new invite, as the page that made it shows it: once, with its link to pass on. */
export interface Invited {
  to: string
  gives: string
  link: string
  emailedTo: string | null
  note: string
}
export type ChangeScope = { access: OrgAccess; userId: string; form: FormData; names: PlaceNames }

/**
 * Runs one access change from a page: the member's access is read now, the
 * change made in the platform schema and audited in the org's own log in the
 * same transaction (§10). A change they may not make is a 403; a mistake
 * they can fix (no such grant, an invalid choice) is a 404 or 400 the page shows.
 * `precomputed` reuses access a caller already read (and already checked, as
 * a docket's Access tab checks the docket first), instead of reading it again.
 */
export async function changeAccess(
  event: RequestEvent,
  change: (tx: Tx, scope: ChangeScope) => Promise<Change>,
  precomputed?: OrgAccess,
): Promise<ActionFailure<{ problem: string }> | { flash: string; invited?: Invited }> {
  const user = requireUser(event)
  const access = precomputed ?? (await orgAccess(event))
  const form = await event.request.formData()
  const names = await placeNames(access.org.id)
  const { router } = getRuntime()
  try {
    const done = await router.withPlatform(async (tx) => {
      const result = await change(tx, { access, userId: user.id, form, names })
      await router.enterTenant(tx, access.org.id)
      await result.inOrg?.(tx)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, target: result.target, args: result.args })
      return result
    })
    const after = await done.after?.()
    return { flash: after?.flash ?? done.flash, ...(after?.invited ? { invited: after.invited } : {}) }
  } catch (cause) {
    // A change the member may not make is refused outright, as any other route refuses it; a mistake they can fix is shown.
    if (cause instanceof TenancyError && cause.code === 'forbidden') error(403, cause.message)
    if (cause instanceof TenancyError) return fail(cause.code === 'not-found' ? 404 : 400, { problem: cause.message })
    throw cause
  }
}

const describe = (grant: GrantView, names: PlaceNames, orgName: string) => `${grantRoleLabel(grant)} on ${placeLabel(grant.place, names, orgName)}`

const whoOf = (grant: GrantView) => (grant.grantee.kind === 'everyone' ? 'everyone' : grant.grantee.login)

/** Gives the grantee a form names (or `only`'s) the role on the place it names (or `at`), replacing their grant there. */
export async function giveChange(tx: Tx, { access, userId, form, names }: ChangeScope, only?: Grantee, at?: Place): Promise<Change> {
  const place = at ?? placeOf(form.get('place'), names)
  if (!place) throw new TenancyError('invalid', 'Choose where.')
  const roles = await listRoles(tx, access.org.id)
  const who = only ?? granteeOf(form)
  const { roleId, add, remove } = adjustmentOf(form, roles)
  const { grant, before } = await setGrant(tx, { orgId: access.org.id, who, place, roleId, add, remove, actor: access.principal, actorId: userId })
  return {
    action: before ? 'access.change' : 'access.grant',
    target: [`grant:${grant.id}`, grant.who.kind === 'user' ? `user:${grant.who.id}` : 'everyone'],
    args: { place: placeKey(place), role: roleId, add, remove, ...(before ? { before: { role: before.role.id, add: before.add, remove: before.remove } } : {}) },
    flash: `${whoOf(grant)} now has ${describe(grant, names, access.org.name)}.`,
  }
}

async function grantNamed(tx: Tx, orgId: string, grantId: string, only?: Grantee, at?: Place): Promise<GrantView> {
  const grant = (await listGrants(tx, orgId)).find((each) => each.id === grantId)
  if (!grant || (only && JSON.stringify(only) !== JSON.stringify(grant.who)) || (at && placeKey(at) !== placeKey(grant.place))) {
    throw new TenancyError('not-found', 'No such grant.')
  }
  return grant
}

/** Changes the role and adjustments of the grant a form names. */
export async function adjustChange(tx: Tx, { access, userId, form, names }: ChangeScope, only?: Grantee, at?: Place): Promise<Change> {
  const existing = await grantNamed(tx, access.org.id, String(form.get('grant') ?? ''), only, at)
  const roles = await listRoles(tx, access.org.id)
  const { roleId, add, remove } = adjustmentOf(form, roles)
  const { grant } = await setGrant(tx, { orgId: access.org.id, who: existing.who, place: existing.place, roleId, add, remove, actor: access.principal, actorId: userId })
  return {
    action: 'access.change',
    target: [`grant:${grant.id}`, grant.who.kind === 'user' ? `user:${grant.who.id}` : 'everyone'],
    args: { place: placeKey(grant.place), role: roleId, add, remove, before: { role: existing.role.id, add: existing.add, remove: existing.remove } },
    flash: `${whoOf(grant)} now has ${describe(grant, names, access.org.name)}.`,
  }
}

/** Takes away the grant `grantId` names. */
export async function revokeChange(tx: Tx, { access, names }: ChangeScope, grantId: string, only?: Grantee, at?: Place): Promise<Change> {
  await grantNamed(tx, access.org.id, grantId, only, at)
  const grant = await removeGrant(tx, { orgId: access.org.id, grantId, actor: access.principal })
  return {
    action: 'access.remove',
    target: [`grant:${grant.id}`, grant.who.kind === 'user' ? `user:${grant.who.id}` : 'everyone'],
    args: { place: placeKey(grant.place), role: grant.role.id },
    flash: `${whoOf(grant)} no longer has ${describe(grant, names, access.org.name)}.`,
  }
}

/**
 * The three access actions every page with grants offers: give, adjust and
 * remove. `only` keeps them to one grantee; `at` to one place, checked first
 * (a docket's Access tab answers 404 or 403 for a docket the member may not
 * read, as every docket route does) - its access is then reused for the
 * change itself, rather than read from the platform a second time.
 */
export function grantActions(options: { only?: (event: RequestEvent) => Grantee; at?: (event: RequestEvent) => Promise<{ access: OrgAccess; place: Place }> } = {}) {
  const { only, at } = options
  const run = (event: RequestEvent, change: (tx: Tx, scope: ChangeScope, who: Grantee | undefined, place: Place | undefined) => Promise<Change>) =>
    (at ? at(event) : Promise.resolve(undefined)).then((pinned) =>
      changeAccess(event, (tx, scope) => change(tx, scope, only?.(event), pinned?.place), pinned?.access),
    )
  return {
    give: (event: RequestEvent) => run(event, (tx, scope, who, place) => giveChange(tx, scope, who, place)),
    adjust: (event: RequestEvent) => run(event, (tx, scope, who, place) => adjustChange(tx, scope, who, place)),
    revoke: (event: RequestEvent) => run(event, (tx, scope, who, place) => revokeChange(tx, scope, String(scope.form.get('grant') ?? ''), who, place)),
  }
}
