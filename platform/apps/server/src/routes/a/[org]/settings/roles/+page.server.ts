// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, deleteRole, mayEditRoles, saveRole } from '@docket/platform-tenancy'
import { error } from '@sveltejs/kit'

import { capsFrom, changeAccess, rolesFor } from '$lib/server/grants'
import { orgAccess } from '$lib/server/request'

import type { Actions, PageServerLoad } from './$types'

/**
 * Settings › Roles (tenancy v2 §3.1): a role is a named bundle of
 * capabilities. Reader, Writer and Admin are built in and fixed; the account
 * makes its own beside them, and changing one changes it for everyone who
 * holds it. Only an admin on the whole account changes them; everyone else
 * who reaches Settings reads them. A guest sees none of it.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  if (access.principal.guest) error(404, 'Not found')
  return {
    roles: await rolesFor(access.org.id),
    mayEdit: mayEditRoles(access.principal),
    editing: event.url.searchParams.get('edit'),
  }
}

export const actions: Actions = {
  save: (event) =>
    changeAccess(event, async (tx, { access, userId, form }) => {
      const id = String(form.get('id') ?? '') || undefined
      const { role, before } = await saveRole(tx, {
        orgId: access.org.id,
        ...(id ? { id } : {}),
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        caps: capsFrom(form),
        actor: access.principal,
        actorId: userId,
      })
      return {
        action: before ? 'roles.change' : 'roles.create',
        target: [`role:${role.id}`],
        args: { name: role.name, caps: role.caps, ...(before ? { before: { name: before.name, caps: before.caps } } : {}) },
        flash: before ? `Saved ${role.name}: everyone who holds it has its capabilities now.` : `Made the role ${role.name}. Give it from Users, or a docket's Access tab.`,
      }
    }),

  delete: (event) =>
    changeAccess(event, async (tx, { access, form }) => {
      const id = String(form.get('id') ?? '')
      if (!id) throw new TenancyError('invalid', 'Choose a role.')
      const role = await deleteRole(tx, { orgId: access.org.id, id, actor: access.principal })
      return { action: 'roles.delete', target: [`role:${role.id}`], args: { name: role.name }, flash: `Deleted the role ${role.name}.` }
    }),
}
