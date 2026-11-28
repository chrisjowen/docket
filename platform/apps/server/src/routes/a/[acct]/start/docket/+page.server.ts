// SPDX-License-Identifier: AGPL-3.0-only
import { error, redirect } from '@sveltejs/kit'

import { ONBOARDING_PARAM } from '$lib/onboarding'
import { settingUp } from '$lib/server/onboarding'
import { spaceToCreateIn } from '$lib/server/spaces'

import type { PageServerLoad } from './$types'

/**
 * Signing up, step 4 (tenancy v2 §6): the first docket, made on the same New
 * docket page as every other, opened from General's +. Made there, it goes on
 * to step 5.
 */
export const load: PageServerLoad = async (event) => {
  const access = await settingUp(event)
  const space = await spaceToCreateIn(access)
  if (!space) error(403, 'You cannot add a docket anywhere in this account.')
  redirect(307, `/a/${access.org.slug}/s/${space.slug}/new?${ONBOARDING_PARAM}=1`)
}
