// SPDX-License-Identifier: AGPL-3.0-only
import { startInstall } from '$lib/server/github-link'
import { authorise } from '$lib/server/request'
import { docketAccess } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * Off to GitHub to install the app on more repos; back through
 * `/github/setup`. A link, not a form: the page's CSP lets forms post only
 * to this origin, and the install happens on github.com.
 */
export const GET: RequestHandler = async (event) => {
  const { access } = await docketAccess(event)
  authorise(access, 'repos.connect')
  startInstall(event, { org: access.org.slug, ws: event.params.ws })
}
