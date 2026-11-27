// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from '@sveltejs/kit'

import { HOME_TAB, QUERY_TAB } from '$lib/workspace-nav'

import type { PageServerLoad } from './$types'

/**
 * A docket opens on its overview. The bare address, which used to open the
 * graph, stays a working link: it redirects to the overview, or to the graph
 * when it carries a query (`?focus=`), which only the graph ever read. The
 * layout's load runs first, so a workspace the org does not have is still 404.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
  await parent()
  redirect(307, `${url.pathname.replace(/\/$/, '')}/${url.search ? QUERY_TAB : HOME_TAB}${url.search}`)
}
