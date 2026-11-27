// SPDX-License-Identifier: AGPL-3.0-only
import { WorkspaceError, insertSpace, newSpaceProblem } from '@docket/platform-canonical-store'
import { mayCreateSpace } from '@docket/platform-tenancy'
import { error, fail, redirect } from '@sveltejs/kit'

import { orgAccess, recordAudit, requireUser, type OrgAccess } from '$lib/server/request'
import { inOrg } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * Spaces + (tenancy v2 §2): a new space, for a team, department or client.
 * Admins on the whole account make them (§10, question 9); whoever is given
 * access on the space then adds its dockets and its people.
 */
function mayCreate(access: OrgAccess): void {
  if (!mayCreateSpace(access.principal)) error(403, 'Only an admin on the whole account can make a space.')
}

export const load: PageServerLoad = async (event) => {
  mayCreate(await orgAccess(event))
  return {}
}

export const actions: Actions = {
  default: async (event) => {
    const user = requireUser(event)
    const access = await orgAccess(event)
    mayCreate(access)
    const form = await event.request.formData()
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim().toLowerCase()
    const description = String(form.get('description') ?? '').trim()
    const values = { name, slug, description }
    let created: string
    try {
      created = await inOrg(access, async (ctx) => {
        const problem = await newSpaceProblem(ctx.tx, { name, slug })
        if (problem) throw new WorkspaceError('invalid', problem)
        const space = await insertSpace(ctx.tx, { name, slug, description, createdBy: `user:${user.id}` })
        await recordAudit(ctx.tx, event, { action: 'space.create', orgId: access.org.id, target: [`space:${space.id}`], args: { slug, name } })
        return space.slug
      })
    } catch (caught) {
      if (caught instanceof WorkspaceError) return fail(400, { ...values, problem: caught.message })
      throw caught
    }
    redirect(303, `/o/${access.org.slug}/s/${created}/access`)
  },
}
