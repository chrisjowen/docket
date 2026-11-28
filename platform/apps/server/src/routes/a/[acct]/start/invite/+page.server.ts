// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, createInvite, placeKey, type IssuedInvite } from '@docket/platform-tenancy'
import { fail } from '@sveltejs/kit'

import { onboardingDone } from '$lib/onboarding'
import { placeLabel, placeNames, placeOf, placesToGive, rolesFor, type Invited } from '$lib/server/grants'
import { inviteeOf, invitedView } from '$lib/server/invites'
import { firstDocketOf, settingUp } from '$lib/server/onboarding'
import { recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

/** How many people this step invites at once; Users › Invite invites more later. */
const ROWS = 5

/**
 * Signing up, step 6 (tenancy v2 §6): invite users, one row each - a GitHub
 * login or an email, a role and a place. Each invite is a link that works
 * once, for 7 days, emailed where there is an address. Then step 7: done,
 * in the first docket's Chat tab.
 */
export const load: PageServerLoad = async (event) => {
  const access = await settingUp(event)
  const names = await placeNames(access.org.id)
  const docket = firstDocketOf(event.url)
  const first = docket ? [...names.dockets.entries()].find(([, entry]) => entry.slug === docket) : undefined
  return {
    roles: (await rolesFor(access.org.id)).map((role) => ({ id: role.id, name: role.name })),
    places: placesToGive(access, names),
    /** Where a row invites to unless changed: General, where everyone already reads, so a role there widens it. */
    defaultPlace: 'space:general',
    firstDocket: first ? { slug: first[1].slug, name: first[1].name, place: `docket:${first[0]}` } : null,
    rows: ROWS,
    done: onboardingDone(access.org.slug, first ? first[1].slug : null),
  }
}

export const actions: Actions = {
  default: async (event) => {
    const user = requireUser(event)
    const access = await settingUp(event)
    const form = await event.request.formData()
    const names = await placeNames(access.org.id)
    const who = form.getAll('who').map((value) => String(value).trim())
    const roles = form.getAll('role').map(String)
    const places = form.getAll('place').map(String)
    const rows = who
      .map((to, index) => ({ to, role: roles[index] ?? 'writer', place: places[index] ?? 'space:general', row: index + 1 }))
      .filter((row) => row.to)
      .slice(0, ROWS)
    const typed = rows.map(({ to, role, place }) => ({ to, role, place }))
    if (!rows.length) return fail(400, { rows: typed, problem: 'Enter a GitHub login or an email on a row, or skip this step.' })

    const { router } = getRuntime()
    let made: { invite: IssuedInvite; placeName: string }[]
    try {
      // All or none: a row that cannot be sent is shown, and nothing is sent until every row can be.
      made = await router.withPlatform(async (tx) => {
        const out: { invite: IssuedInvite; placeName: string }[] = []
        for (const row of rows) {
          const place = placeOf(row.place, names)
          if (!place) throw new TenancyError('invalid', `Row ${row.row}: choose where.`)
          const invite = await createInvite(tx, { orgId: access.org.id, who: row.to, roleId: row.role, place, actorId: user.id, actor: access.principal }).catch((cause: unknown) => {
            if (cause instanceof TenancyError) throw new TenancyError(cause.code, `Row ${row.row} (${row.to}): ${cause.message}`)
            throw cause
          })
          out.push({ invite, placeName: placeLabel(place, names, access.org.name) })
        }
        await router.enterTenant(tx, access.org.id)
        for (const { invite } of out) {
          await recordAudit(tx, event, {
            action: 'members.invite',
            orgId: access.org.id,
            target: [`invite:${invite.id}`],
            args: { who: inviteeOf(invite), role: invite.roleId, place: placeKey(invite.place), guest: false, onboarding: true },
          })
        }
        return out
      })
    } catch (caught) {
      if (caught instanceof TenancyError) return fail(caught.code === 'forbidden' ? 403 : 400, { rows: typed, problem: caught.message })
      throw caught
    }
    const invited: Invited[] = []
    for (const { invite, placeName } of made) invited.push((await invitedView(event, access.org.name, invite, placeName)).invited)
    return { invited }
  },
}
