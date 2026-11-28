// SPDX-License-Identifier: AGPL-3.0-only
import { WorkspaceError, insertSpace, listSpaces, newSpaceProblem } from '@docket/platform-canonical-store'
import { GENERAL_SPACE_ID, TenancyError, listGrants, removeGrant, setGrant, spacePlace } from '@docket/platform-tenancy'
import { fail, redirect } from '@sveltejs/kit'

import { settingUp } from '$lib/server/onboarding'
import { recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { inOrg } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/** What everyone in the account may get on General: Reader by default (tenancy v2 §10, question 5). */
const EVERYONE = ['reader', 'writer', 'none'] as const
type Everyone = (typeof EVERYONE)[number]

/** How many more spaces this step names at once; Spaces + makes more later. */
const MORE_SPACES = 4

/** A space's address from its name: what Spaces + suggests too. */
function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/**
 * Signing up, step 3 (tenancy v2 §6): the account's first space is General.
 * Choose what everyone in the account gets there - Reader by default,
 * Writer, or nothing - and optionally name more spaces, for teams,
 * departments or clients. Then step 4, the first docket.
 */
export const load: PageServerLoad = async (event) => {
  const access = await settingUp(event)
  const { router } = getRuntime()
  const [spaces, everyone] = await Promise.all([
    router.withTenant(access.org.id, listSpaces),
    router.withPlatform(async (tx) => (await listGrants(tx, access.org.id, { place: spacePlace(GENERAL_SPACE_ID) })).find((grant) => grant.who.kind === 'everyone') ?? null),
  ])
  const role = everyone?.role.id
  return {
    everyone: (EVERYONE.find((value) => value === role) ?? (everyone ? 'reader' : 'none')) as Everyone,
    spaces: spaces.map((space) => ({ slug: space.slug, name: space.name, general: space.general })),
    more: MORE_SPACES,
  }
}

export const actions: Actions = {
  default: async (event) => {
    const user = requireUser(event)
    const access = await settingUp(event)
    const form = await event.request.formData()
    const choice = String(form.get('everyone') ?? 'reader')
    const everyone: Everyone = EVERYONE.find((value) => value === choice) ?? 'reader'
    const names = form
      .getAll('space')
      .map((value) => String(value).trim())
      .filter(Boolean)
      .slice(0, MORE_SPACES)
    const values = { everyone, names }
    const { router } = getRuntime()
    const general = spacePlace(GENERAL_SPACE_ID)

    // More spaces first: a name that cannot be one is shown before anything changes.
    try {
      await inOrg(access, async (ctx) => {
        const seen = new Set<string>()
        for (const name of names) {
          const slug = slugFor(name)
          if (seen.has(slug)) throw new WorkspaceError('invalid', `Two spaces would be at /s/${slug}: name them apart.`)
          seen.add(slug)
          const problem = await newSpaceProblem(ctx.tx, { name, slug })
          if (problem) throw new WorkspaceError('invalid', `${name}: ${problem}`)
        }
        for (const name of names) {
          const space = await insertSpace(ctx.tx, { name, slug: slugFor(name), createdBy: `user:${user.id}` })
          await recordAudit(ctx.tx, event, { action: 'space.create', orgId: access.org.id, target: [`space:${space.id}`], args: { slug: space.slug, name, onboarding: true } })
        }
      })
    } catch (caught) {
      if (caught instanceof WorkspaceError) return fail(400, { ...values, problem: caught.message })
      throw caught
    }

    // What everyone gets on General: the grant there, changed, made or taken away.
    try {
      await router.withPlatform(async (tx) => {
        const existing = (await listGrants(tx, access.org.id, { place: general })).find((grant) => grant.who.kind === 'everyone') ?? null
        if (everyone === 'none') {
          if (!existing) return
          await removeGrant(tx, { orgId: access.org.id, grantId: existing.id, actor: access.principal })
        } else {
          if (existing?.role.id === everyone && existing.add.length === 0 && existing.remove.length === 0) return
          await setGrant(tx, { orgId: access.org.id, who: { kind: 'everyone' }, place: general, roleId: everyone, actor: access.principal, actorId: user.id })
        }
        await router.enterTenant(tx, access.org.id)
        await recordAudit(tx, event, {
          action: everyone === 'none' ? 'access.remove' : existing ? 'access.change' : 'access.grant',
          orgId: access.org.id,
          target: ['everyone', `space:${GENERAL_SPACE_ID}`],
          args: { place: `space:${GENERAL_SPACE_ID}`, role: everyone, onboarding: true },
        })
      })
    } catch (caught) {
      if (caught instanceof TenancyError) return fail(400, { ...values, problem: caught.message })
      throw caught
    }
    redirect(303, `/a/${access.org.slug}/start/docket`)
  },
}
