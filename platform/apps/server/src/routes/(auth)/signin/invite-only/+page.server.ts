// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { CSRF_FIELD, csrfToken, hashSecret, verifyCsrf } from '@docket/platform-auth'
import { describeWaitlistEntry, waitlistEntryOf } from '@docket/platform-tenancy'
import { error, fail } from '@sveltejs/kit'

import { auditInput } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { PENDING_COOKIE } from '$lib/server/signin'
import { parseWaitlistForm } from '$lib/server/waitlist'

import type { Actions, PageServerLoad } from './$types'

type Pending = { github_id: string; github_login: string; email: string | null }

/** The GitHub identity this browser signed in as within the hour, which the beta refused. */
async function pendingOf(secret: string | undefined): Promise<Pending | null> {
  if (!secret) return null
  const { rows } = await getRuntime().router.withPlatform((tx) =>
    tx.query<Pending>(
      `SELECT github_id, github_login, email FROM platform.access_requests
        WHERE id_hash = $1 AND created_at > now() - interval '1 hour'`,
      [hashSecret(secret)],
    ),
  )
  return rows[0] ?? null
}

/**
 * "Docket Cloud is invite-only for now" (§8.1). Signing in put the GitHub
 * account on the beta waitlist; here it can say who its team is.
 */
export const load: PageServerLoad = async ({ cookies }) => {
  const secret = cookies.get(PENDING_COOKIE)
  const pending = await pendingOf(secret)
  const entry = pending ? await getRuntime().router.withPlatform((tx) => waitlistEntryOf(tx, Number(pending.github_id))) : null
  return {
    login: pending?.github_login ?? null,
    onList: entry !== null,
    described: Boolean(entry?.teamName),
    email: entry?.email ?? pending?.email ?? null,
    teamName: entry?.teamName ?? null,
    teamSize: entry?.teamSize ?? null,
    csrf: secret && pending ? csrfToken(secret) : null,
  }
}

export const actions: Actions = {
  default: async (event) => {
    const secret = event.cookies.get(PENDING_COOKIE)
    const form = await event.request.formData()
    // No session yet: the token is keyed by the pending cookie's secret instead.
    if (!secret || !verifyCsrf(secret, form.get(CSRF_FIELD))) error(403, 'This form expired. Sign in with GitHub again.')
    const pending = await pendingOf(secret)
    if (!pending) error(403, 'This form expired. Sign in with GitHub again.')
    const parsed = parseWaitlistForm(form)
    if (!parsed.ok) return fail(400, { problems: parsed.problems, values: parsed.values })

    const { email, teamName, teamSize, note } = parsed.request
    const updated = await getRuntime().router.withPlatform(async (tx) => {
      const id = await describeWaitlistEntry(tx, Number(pending.github_id), { email, teamName, teamSize, note })
      if (!id) return false
      await audit(tx, auditInput(event, { action: 'waitlist.details', outcome: 'ok', orgId: null, target: [`waitlist:${id}`, `github:${pending.github_login}`] }))
      return true
    })
    if (!updated) error(403, 'This form expired. Sign in with GitHub again.')
    event.locals.audited = true
    return { sent: true }
  },
}
