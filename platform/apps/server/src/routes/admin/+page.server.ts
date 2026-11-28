// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from '@sveltejs/kit'

import { requirePlatformAdmin } from '$lib/server/request'

import type { PageServerLoad } from './$types'

/** The operator console opens on its accounts; anyone but an operator gets 404. */
export const load: PageServerLoad = (event) => {
  requirePlatformAdmin(event)
  redirect(307, '/admin/accounts')
}
