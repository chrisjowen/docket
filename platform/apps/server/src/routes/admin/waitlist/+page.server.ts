// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, countLiveOrgs, inviteFromWaitlist, listWaitlist } from '@docket/platform-tenancy'
import { fail } from '@sveltejs/kit'

import { recordAudit, requirePlatformAdmin } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'

const FILTERS = ['waiting', 'invited', 'all'] as const
type Filter = (typeof FILTERS)[number]

/** The beta waitlist, for platform admins only: everyone else gets 404. */
export const load: PageServerLoad = async (event) => {
  requirePlatformAdmin(event)
  const asked = event.url.searchParams.get('status')
  const filter: Filter = FILTERS.find((value) => value === asked) ?? 'waiting'
  const { router, maxOrgs } = getRuntime()
  const [entries, waiting, liveOrgs] = await router.withPlatform(async (tx) =>
    Promise.all([
      listWaitlist(tx, filter === 'all' ? {} : { status: filter }),
      listWaitlist(tx, { status: 'waiting' }).then((rows) => rows.length),
      countLiveOrgs(tx),
    ]),
  )
  return {
    filter,
    waiting,
    orgs: { live: liveOrgs, max: maxOrgs },
    entries: entries.map((entry) => ({
      id: entry.id,
      via: entry.via,
      email: entry.email,
      teamName: entry.teamName,
      teamSize: entry.teamSize,
      githubLogin: entry.githubLogin,
      githubVerified: entry.githubVerified,
      note: entry.note,
      status: entry.status,
      allowlisted: entry.allowlisted,
      createdAt: entry.createdAt.toISOString(),
      invitedAt: entry.invitedAt?.toISOString() ?? null,
      invitedByLogin: entry.invitedByLogin,
    })),
  }
}

export const actions: Actions = {
  /** Lets an entry into the beta through the beta's own invite: its verified GitHub account joins the allowlist. */
  invite: async (event) => {
    const admin = requirePlatformAdmin(event)
    const id = String((await event.request.formData()).get('entry') ?? '')
    try {
      const invited = await getRuntime().router.withPlatform(async (tx) => {
        const entry = await inviteFromWaitlist(tx, { id, invitedBy: admin.id })
        await recordAudit(tx, event, {
          action: 'waitlist.invite',
          orgId: null,
          target: [`waitlist:${entry.id}`, `github:${entry.githubLogin}`],
        })
        return entry
      })
      return { invited: { who: invited.teamName ?? invited.email ?? `@${invited.githubLogin}`, login: invited.githubLogin } }
    } catch (error) {
      if (error instanceof TenancyError) return fail(400, { problem: error.message })
      throw error
    }
  },
}
