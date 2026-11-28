// SPDX-License-Identifier: AGPL-3.0-only
import { removeMemberAttributes, trustChanged } from '@docket/platform-canonical-store'
import {
  ACCOUNT,
  TenancyError,
  accountLimits,
  createInvite,
  listGrants,
  listMembers,
  listSystemAccounts,
  mayGrant,
  openInvitesOf,
  removeMember,
  reissueInvite,
  revokeInvite,
  setOwner,
  type Invite,
} from '@docket/platform-tenancy'
import { error } from '@sveltejs/kit'

import { changeAccess, giveChange, grantActions, grantView, placeKey, placeLabel, placeNames, placeOf, placesToGive, revokeChange, rolesFor } from '$lib/server/grants'
import { inviteeOf, invitedView } from '$lib/server/invites'
import { accountRoles } from '$lib/server/members'
import { orgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/**
 * Users (tenancy v2 §3): the people of the account, each with their role on
 * the whole account and, with Explain, every grant they hold. Anyone who
 * manages access somewhere invites people to where they manage it, as a role
 * on that place; whoever manages access on the whole account changes and
 * removes people's access there. Only owners make or unmake owners. A guest
 * sees only what they are given, not this list.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  if (access.principal.guest) error(404, 'Not found')
  const managesAnywhere = access.canAnywhere('access')
  const managesAccount = access.can('access')
  const names = await placeNames(access.org.id)
  const { members, invites, grants, roles, managed, limits } = await getRuntime().router.withPlatform(async (tx) => {
    const members = await listMembers(tx, access.org.id)
    return {
      limits: await accountLimits(tx, access.org.id),
      members,
      invites: managesAnywhere ? await openInvitesOf(tx, access.org.id) : [],
      grants: await listGrants(tx, access.org.id),
      roles: await accountRoles(tx, access.org.id, members),
      managed: new Set((await listSystemAccounts(tx, access.org.id)).filter((account) => account.managed).map((account) => account.id)),
    }
  })
  const iso = (date: Date | null) => (date ? date.toISOString() : null)
  const view = (grant: (typeof grants)[number]) => grantView(grant, access.principal, names, access.org.name)
  const roleList = await rolesFor(access.org.id)
  const roleCaps = new Map(roleList.map((role) => [role.id, role.caps]))
  const mayManageInvite = (invite: Invite) =>
    invite.owner ? access.owner : mayGrant(access.principal, invite.place, roleCaps.get(invite.roleId) ?? [], 'human')
  return {
    me: event.locals.user?.login ?? null,
    manage: managesAnywhere,
    manageAccount: managesAccount,
    isOwner: access.owner,
    limit: limits.maxMembers,
    seats: members.filter((member) => !managed.has(member.id)).length + invites.length,
    systemAccounts: members.filter((member) => member.kind === 'service' && !managed.has(member.id)).length,
    roles: roleList,
    invitePlaces: managesAnywhere ? placesToGive(access, names) : [],
    everyone: grants.filter((grant) => grant.who.kind === 'everyone').map(view),
    people: members
      .filter((member) => member.kind === 'human')
      .map((member) => {
        const own = grants.filter((grant) => grant.who.kind === 'user' && grant.who.id === member.id)
        const onAccount = own.find((grant) => grant.place.kind === 'account')
        return {
          id: member.id,
          login: member.login,
          name: member.name,
          email: managesAccount ? member.email : null,
          owner: member.owner,
          guest: member.guest,
          role: roles.get(member.id) ?? '',
          accountRole: onAccount?.role.id ?? null,
          accountGrant: onAccount ? view(onAccount) : null,
          grants: own.map(view),
          joinedAt: iso(member.joinedAt),
          lastSeenAt: iso(member.lastSeenAt),
        }
      }),
    invites: invites.filter(mayManageInvite).map((invite) => ({
      id: invite.id,
      githubLogin: invite.githubLogin,
      email: invite.email,
      role: invite.owner ? 'Owner' : invite.roleName,
      place: placeLabel(invite.place, names, access.org.name),
      guest: invite.guest,
      invitedByLogin: invite.invitedByLogin,
      createdAt: iso(invite.createdAt),
      expiresAt: iso(invite.expiresAt),
      emailedTo: invite.emailedTo,
    })),
    accountPlace: placeKey(ACCOUNT),
  }
}

const grants = grantActions()

export const actions: Actions = {
  ...grants,

  invite: (event) =>
    changeAccess(event, async (tx, { access, userId, form, names }) => {
      const place = placeOf(form.get('place') ?? 'account', names)
      if (!place) throw new TenancyError('invalid', 'Choose where.')
      const invite = await createInvite(tx, {
        orgId: access.org.id,
        who: String(form.get('who') ?? ''),
        roleId: String(form.get('role') ?? ''),
        place,
        guest: form.get('guest') === 'on',
        actorId: userId,
        actor: access.principal,
      })
      return {
        action: 'members.invite',
        target: [`invite:${invite.id}`],
        args: { who: inviteeOf(invite), role: invite.roleId, place: placeKey(place), guest: invite.guest },
        flash: `Invited ${inviteeOf(invite)}.`,
        after: () => invitedView(event, access.org.name, invite, placeLabel(place, names, access.org.name)),
      }
    }),

  /** Sends an open invite again: a new link for 7 more days, and the old one stops working. */
  resendInvite: (event) =>
    changeAccess(event, async (tx, { access, form, names }) => {
      const invite = await reissueInvite(tx, { orgId: access.org.id, inviteId: String(form.get('invite') ?? ''), actor: access.principal })
      return {
        action: 'members.invite.resend',
        target: [`invite:${invite.id}`],
        flash: `Sent the invite for ${inviteeOf(invite)} again.`,
        after: async () => {
          const sent = await invitedView(event, access.org.name, invite, placeLabel(invite.place, names, access.org.name))
          return { ...sent, flash: `Sent the invite for ${inviteeOf(invite)} again, with a new link for 7 more days; the old one no longer works. ${sent.invited.note}` }
        },
      }
    }),

  revokeInvite: (event) =>
    changeAccess(event, async (tx, { access, form }) => {
      const invite = await revokeInvite(tx, { orgId: access.org.id, inviteId: String(form.get('invite') ?? ''), actor: access.principal })
      return {
        action: 'members.invite.revoke',
        target: [`invite:${invite.id}`],
        flash: `Cancelled the invite for ${inviteeOf(invite)}. Its link no longer works.`,
      }
    }),

  /** Sets someone's role on the whole account: a grant there, or none. */
  accountRole: (event) =>
    changeAccess(event, async (tx, scope) => {
      const member = String(scope.form.get('member') ?? '')
      if (String(scope.form.get('role') ?? '') !== 'none') {
        scope.form.set('place', 'account')
        return giveChange(tx, scope, { kind: 'user', id: member })
      }
      const existing = (await listGrants(tx, scope.access.org.id, { place: ACCOUNT, userId: member }))[0]
      if (!existing) return { action: 'access.remove', target: [`user:${member}`], flash: 'No change.' }
      return revokeChange(tx, scope, existing.id)
    }),

  owner: (event) =>
    changeAccess(event, async (tx, { access, form }) => {
      const member = String(form.get('member') ?? '')
      const owner = form.get('owner') === 'true'
      const was = await setOwner(tx, { orgId: access.org.id, userId: member, owner, actor: access.principal })
      return {
        action: 'members.owner',
        target: [`user:${member}`],
        args: { from: was, to: owner },
        flash: was === owner ? 'No change.' : owner ? 'They now own the account too.' : 'They no longer own the account.',
      }
    }),

  remove: (event) =>
    changeAccess(event, async (tx, { access, form }) => {
      const userId = String(form.get('member') ?? '')
      const removed = await removeMember(tx, { orgId: access.org.id, userId, actor: access.principal })
      return {
        action: 'members.remove',
        target: [`user:${userId}`],
        args: removed,
        flash: 'Member removed.',
        // What the directory said about them goes too: no policy trusts a role they no longer hold here.
        inOrg: async (tenant) => {
          if (await removeMemberAttributes({ tx: tenant }, userId)) await trustChanged(tenant)
        },
      }
    }),
}
