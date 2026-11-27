// SPDX-License-Identifier: AGPL-3.0-only
import { call, checkCompatible, refused, useCsrf } from '$lib/api'
import { sessionOf } from '$lib/views'
import { THEME_COOKIE, themeOf, type Theme } from '$platform/theme'

import type { LayoutLoad } from './$types'

// A single-page app: every page draws in the browser from the API.
export const ssr = false
export const prerender = false

const cookieTheme = (): Theme => themeOf(document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`))?.[1])

/** The signed-in user and their accounts (`me.get`), as the server's root layout gives its pages. */
export const load: LayoutLoad = async ({ fetch, url }) => {
  const theme = cookieTheme()
  document.documentElement.dataset.theme = theme
  try {
    const me = await call(fetch, 'me.get')
    checkCompatible()
    useCsrf(me.csrf)
    return { ...sessionOf(me), theme }
  } catch (cause) {
    refused(cause, url)
  }
}
