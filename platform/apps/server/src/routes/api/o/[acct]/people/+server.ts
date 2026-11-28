// SPDX-License-Identifier: AGPL-3.0-only
import { json } from '@sveltejs/kit'

import { authoriseAnywhere, orgAccess } from '$lib/server/request'
import { directory } from '$lib/server/trust'
import { inOrg } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * The people directory: every person in the org, with what it attests about
 * them as a source - a role, a team, flags - and the service accounts acting
 * for them. Any member reads it; 404 outside the org (§5.5). The hook audits the call.
 */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authoriseAnywhere(access, 'read')
  return json({ org: access.org.slug, people: await inOrg(access, (ctx) => directory(access, ctx)) })
}
