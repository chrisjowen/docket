// SPDX-License-Identifier: AGPL-3.0-only
import type { InitialAccess } from '@docket/platform-ontology-service'
import {
  TenancyError,
  docketPlace,
  grantCaps,
  listMembers,
  listRoles,
  listSystemAccounts,
  mayGrant,
  setGrant,
  spacePlace,
  type Access,
  type Role,
} from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { placeKey } from './grants'
import { recordAudit, requireUser, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * A new docket's initial access (tenancy v2 §2, §8): who gets a role on it
 * when it is made, beyond everyone its space and the account already give
 * access. Chosen on New docket, kept with a drafted docket until it is
 * accepted, and given as the creator: no one gives more than they hold on the
 * space, where they must manage access (or system accounts, for one of those).
 */

export interface AccessChoices {
  /** Whether the creator may give anyone access there at all. */
  gives: boolean
  people: { id: string; label: string; kind: 'everyone' | 'human' | 'service' }[]
  roles: { id: string; name: string }[]
}

/** Who and which roles New docket offers in its initial access, for a docket in `spaceId`. */
export async function accessChoices(access: OrgAccess, spaceId: string): Promise<AccessChoices> {
  const here = spacePlace(spaceId)
  const caps = access.capsAt(here)
  if (!caps.has('access') && !caps.has('system')) return { gives: false, people: [], roles: [] }
  const { members, managed, roles } = await getRuntime().router.withPlatform(async (tx) => ({
    members: await listMembers(tx, access.org.id),
    managed: new Set((await listSystemAccounts(tx, access.org.id)).filter((account) => account.managed).map((account) => account.id)),
    roles: await listRoles(tx, access.org.id),
  }))
  const people: AccessChoices['people'] = [
    ...(caps.has('access') ? [{ id: 'everyone', label: `Everyone at ${access.org.name}`, kind: 'everyone' as const }] : []),
    ...members
      .filter((member) => !member.owner && !managed.has(member.id) && member.id !== access.principal.userId)
      .filter((member) => (member.kind === 'human' ? caps.has('access') : true))
      .map((member) => ({
        id: member.id,
        label: member.kind === 'service' ? `${member.login} (system account)` : `${member.name ?? member.login} (@${member.login})${member.guest ? ', guest' : ''}`,
        kind: member.kind,
      })),
  ]
  // Only roles the creator could give here.
  const givable = roles.filter((role) => people.some((person) => mayGrant(access.principal, here, role.caps, person.kind)))
  return { gives: people.length > 0 && givable.length > 0, people, roles: givable.map((role) => ({ id: role.id, name: role.name })) }
}

/**
 * The initial access a New docket form chose (`access_who`/`access_role`
 * pairs), checked: each grantee is one offered, each role one the creator may
 * give them here, and no grantee twice. A problem to show, or the list.
 */
export async function initialAccessFrom(form: FormData, access: OrgAccess, spaceId: string, choices: AccessChoices): Promise<InitialAccess[] | string> {
  const who = form.getAll('access_who').map(String)
  const role = form.getAll('access_role').map(String)
  const rows: InitialAccess[] = []
  const seen = new Set<string>()
  const roles = new Map<string, Role>(
    (await getRuntime().router.withPlatform((tx) => listRoles(tx, access.org.id))).map((each) => [each.id, each] as const),
  )
  for (const [index, id] of who.entries()) {
    if (!id) continue
    const person = choices.people.find((each) => each.id === id)
    const chosen = roles.get(role[index] ?? '')
    if (!person || !chosen || !choices.roles.some((each) => each.id === chosen.id)) return 'Choose who gets access, and a role you can give them here.'
    if (seen.has(id)) return `${person.label} is listed twice.`
    if (!mayGrant(access.principal, spacePlace(spaceId), grantCaps({ role: chosen, add: [], remove: [] }), person.kind)) {
      return `You can only give ${person.label} access you hold on this space yourself.`
    }
    seen.add(id)
    rows.push({ who: id, roleId: chosen.id })
  }
  return rows
}

/**
 * Gives a docket just made its initial access, as its creator, in one
 * transaction audited in the org's own log. The creator's access is read with
 * the new docket in its space, so what they hold on the space counts there.
 * Returns the problem when the grants could not be given (the docket stays;
 * its Access tab can give them).
 */
export async function giveInitialAccess(
  event: RequestEvent,
  access: OrgAccess,
  workspace: { id: string; spaceId: string },
  rows: readonly InitialAccess[],
): Promise<string | null> {
  if (!rows.length) return null
  const user = requireUser(event)
  const actor: Access = { ...access.principal, spaces: new Map([...(access.principal.spaces ?? []), [workspace.id, workspace.spaceId]]) }
  const place = docketPlace(workspace.id)
  const { router } = getRuntime()
  try {
    await router.withPlatform(async (tx) => {
      const given = []
      for (const row of rows) {
        const who = row.who === 'everyone' ? ({ kind: 'everyone' } as const) : ({ kind: 'user', id: row.who } as const)
        const { grant } = await setGrant(tx, { orgId: access.org.id, who, place, roleId: row.roleId, actor, actorId: user.id })
        given.push(grant)
      }
      await router.enterTenant(tx, access.org.id)
      for (const grant of given) {
        await recordAudit(tx, event, {
          action: 'access.grant',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`grant:${grant.id}`, grant.who.kind === 'user' ? `user:${grant.who.id}` : 'everyone'],
          args: { place: placeKey(place), role: grant.role.id, add: [], remove: [], initial: true },
        })
      }
    })
    return null
  } catch (cause) {
    if (cause instanceof TenancyError) return cause.message
    throw cause
  }
}
