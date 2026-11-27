// SPDX-License-Identifier: AGPL-3.0-only
import { error, redirect } from '@sveltejs/kit'

import { orgAccess } from '$lib/server/request'
import { spaceToCreateIn } from '$lib/server/spaces'

import type { RequestHandler } from './$types'

/**
 * The address New docket had before spaces (tenancy v2 phase 3): New docket
 * is now a space's own page, with the space already chosen. This one keeps
 * working and goes to General's, or to the first space where the member may
 * add a docket.
 */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event)
  const space = await spaceToCreateIn(access)
  if (!space) error(403, 'You do not have access to that.')
  redirect(303, `/o/${access.org.slug}/s/${space.slug}/new${event.url.search}`)
}
