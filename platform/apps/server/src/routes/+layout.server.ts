// SPDX-License-Identifier: AGPL-3.0-only
import { sessionView } from '$lib/server/shell'
import { THEME_COOKIE, themeOf } from '$lib/theme'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const user = locals.user
  const theme = themeOf(cookies.get(THEME_COOKIE))
  if (!user) return { user: null, csrf: null, orgs: [], theme }
  return { ...(await sessionView(user)), csrf: locals.csrf, theme }
}
