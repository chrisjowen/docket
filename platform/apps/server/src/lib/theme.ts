// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The light or dark theme. Light is the default; the sidebar's toggle stores
 * the choice in a cookie, so the server renders `<html data-theme>` with it
 * and the page never flashes the other theme (the CSP refuses inline scripts).
 */
export const THEME_COOKIE = 'docket-theme'

export type Theme = 'light' | 'dark'

export const themeOf = (value: string | undefined | null): Theme => (value === 'dark' ? 'dark' : 'light')

/** Fills app.html's `%docket.theme%` placeholder with the request's theme. */
export const withTheme =
  (cookie: string | undefined) =>
  ({ html }: { html: string }): string =>
    html.replace('%docket.theme%', themeOf(cookie))

/** Switches the page to `theme` and remembers it in the cookie, for the app's toggle and the public pages'. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`
}
