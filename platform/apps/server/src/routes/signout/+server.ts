// SPDX-License-Identifier: AGPL-3.0-only
import { SESSION_COOKIE, revokeSession } from '@docket/platform-auth'
import { redirect } from '@sveltejs/kit'

import { recordAudit } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { RequestHandler } from './$types'

/** Ends the session. A POST, so it carries the CSRF token the hook checks. */
export const POST: RequestHandler = async (event) => {
  const secret = event.locals.sessionSecret
  if (secret) {
    await getRuntime().router.withPlatform(async (tx) => {
      await revokeSession(tx, secret)
      await recordAudit(tx, event, { action: 'auth.signout', orgId: null })
    })
  }
  event.cookies.delete(SESSION_COOKIE, { path: '/' })
  redirect(303, '/signin')
}
