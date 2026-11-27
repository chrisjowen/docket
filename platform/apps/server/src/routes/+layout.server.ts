// SPDX-License-Identifier: AGPL-3.0-only
import { membershipsOf } from '@docket/platform-tenancy'

import { isPlatformAdmin } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { THEME_COOKIE, themeOf } from '$lib/theme'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const user = locals.user
  const theme = themeOf(cookies.get(THEME_COOKIE))
  if (!user) return { user: null, csrf: null, orgs: [], theme }
  const orgs = await getRuntime().router.withPlatform((tx) => membershipsOf(tx, user.id))
  return {
    user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl, allowlisted: user.allowlisted, platformAdmin: isPlatformAdmin(user) },
    csrf: locals.csrf,
    orgs: orgs.map(({ org, role }) => ({ slug: org.slug, name: org.name, role })),
    theme,
  }
}
