// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from '@sveltejs/kit'

import type { PageServerLoad } from './$types'

/** Setting up an account (tenancy v2 §6) goes on from its spaces, step 3. */
export const load: PageServerLoad = ({ params, url }) => {
  redirect(307, `/a/${params.org}/start/space${url.search}`)
}
