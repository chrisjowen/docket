// SPDX-License-Identifier: AGPL-3.0-only
import { removeMemberAttributes, trustChanged } from '@docket/platform-canonical-store'
import {
  LIMITS,
  TenancyError,
  assignableRoles,
  changeRole,
  createInvite,
  createServiceAccount,
  isRole,
  listMembers,
  openInvitesOf,
  removeMember,
  revokeInvite,
  setAccountable,
  type Tx,
} from '@docket/platform-tenancy'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { authorise, orgAccess, recordAudit, requireUser, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  const { members, invites } = await getRuntime().router.withPlatform(async (tx) => ({
    members: await listMembers(tx, access.org.id),
    invites: access.can('members.manage') ? await openInvitesOf(tx, access.org.id) : [],
  }))
  const iso = (date: Date | null) => (date ? date.toISOString() : null)
  return {
    me: event.locals.user?.login ?? null,
    manage: access.can('members.manage'),
    assignable: access.can('members.manage') ? assignableRoles(access.role) : [],
    limit: LIMITS.membersPerOrg,
    seats: members.length + invites.length,
    people: members
      .filter((member) => member.kind === 'human')
      .map((member) => ({
        id: member.id,
        login: member.login,
        name: member.name,
        email: access.can('members.manage') ? member.email : null,
        role: member.role,
        joinedAt: iso(member.joinedAt),
        lastSeenAt: iso(member.lastSeenAt),
      })),
    services: members
      .filter((member) => member.kind === 'service')
      .map((member) => ({
        id: member.id,
        name: member.login,
        description: member.description,
        role: member.role,
        actsFor: member.actsFor,
        joinedAt: iso(member.joinedAt),
      })),
    invites: invites.map((invite) => ({
      id: invite.id,
      githubLogin: invite.githubLogin,
      email: invite.email,
      role: invite.role,
      invitedByLogin: invite.invitedByLogin,
      createdAt: iso(invite.createdAt),
      expiresAt: iso(invite.expiresAt),
    })),
  }
}

/**
 * Runs one member-management change: authorise, change the platform rows,
 * then audit in the org's own log in the same transaction (§10).
 */
async function manage(
  event: RequestEvent,
  change: (
    tx: Tx,
    access: OrgAccess,
    form: FormData,
    actorId: string,
  ) => Promise<{ action: string; target: string[]; args?: unknown; flash: string; inOrg?: (tx: Tx) => Promise<void> }>,
) {
  const user = requireUser(event)
  const access = await orgAccess(event)
  authorise(access, 'members.manage')
  const form = await event.request.formData()
  const { router } = getRuntime()
  try {
    const done = await router.withPlatform(async (tx) => {
      const result = await change(tx, access, form, user.id)
      await router.enterTenant(tx, access.org.id)
      await result.inOrg?.(tx)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, target: result.target, args: result.args })
      return result
    })
    return { flash: done.flash }
  } catch (error) {
    if (error instanceof TenancyError) return fail(error.code === 'forbidden' ? 403 : 400, { problem: error.message })
    throw error
  }
}

function roleFrom(form: FormData) {
  const role = form.get('role')
  if (!isRole(role)) throw new TenancyError('invalid', 'Choose a role.')
  return role
}

export const actions: Actions = {
  invite: (event) =>
    manage(event, async (tx, access, form, actorId) => {
      const who = String(form.get('who') ?? '')
      const invite = await createInvite(tx, { orgId: access.org.id, who, role: roleFrom(form), actorId, actorRole: access.role })
      const to = invite.githubLogin ? `@${invite.githubLogin}` : (invite.email ?? '')
      return {
        action: 'members.invite',
        target: [`invite:${invite.id}`],
        args: { who: to, role: invite.role },
        flash: `Invited ${to} as ${invite.role}. Ask them to sign in at this site with GitHub.`,
      }
    }),

  revokeInvite: (event) =>
    manage(event, async (tx, access, form) => {
      const invite = await revokeInvite(tx, { orgId: access.org.id, inviteId: String(form.get('invite') ?? '') })
      return {
        action: 'members.invite.revoke',
        target: [`invite:${invite.id}`],
        flash: `Cancelled the invite for ${invite.githubLogin ? `@${invite.githubLogin}` : invite.email}.`,
      }
    }),

  changeRole: (event) =>
    manage(event, async (tx, access, form) => {
      const userId = String(form.get('member') ?? '')
      const role = roleFrom(form)
      const from = await changeRole(tx, { orgId: access.org.id, userId, role, actorRole: access.role })
      return {
        action: 'members.role',
        target: [`user:${userId}`],
        args: { from, to: role },
        flash: from === role ? 'No change.' : `Role changed from ${from} to ${role}.`,
      }
    }),

  remove: (event) =>
    manage(event, async (tx, access, form) => {
      const userId = String(form.get('member') ?? '')
      const role = await removeMember(tx, { orgId: access.org.id, userId, actorRole: access.role })
      return {
        action: 'members.remove',
        target: [`user:${userId}`],
        args: { role },
        flash: 'Member removed.',
        // What the directory said about them goes too: no policy trusts a role they no longer hold here.
        inOrg: async (tenant) => {
          if (await removeMemberAttributes({ tx: tenant }, userId)) await trustChanged(tenant)
        },
      }
    }),

  actsFor: (event) =>
    manage(event, async (tx, access, form) => {
      const serviceId = String(form.get('member') ?? '')
      const changed = await setAccountable(tx, { orgId: access.org.id, serviceId, accountableLogin: String(form.get('person') ?? '') })
      return {
        action: 'members.service-account.acts-for',
        target: [`user:${serviceId}`],
        args: { from: changed.before, to: changed.after },
        flash: `${changed.service} now acts for @${changed.after}.`,
      }
    }),

  addService: (event) =>
    manage(event, async (tx, access, form, actorId) => {
      const name = String(form.get('name') ?? '').trim().toLowerCase()
      const description = String(form.get('description') ?? '').trim().slice(0, 200) || null
      const account = await createServiceAccount(tx, {
        orgId: access.org.id,
        name,
        description,
        role: roleFrom(form),
        actorId,
        actorRole: access.role,
      })
      return {
        action: 'members.service-account.create',
        target: [`user:${account.id}`],
        flash: `Service account ${account.login} added. Create its API tokens on a docket's MCP page.`,
      }
    }),
}
