// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The product's pages moved (tenancy v2 §2, phase 6): an account is
 * `/a/{acct}` and a docket in it `/a/{acct}/d/{docket}`, where they were
 * `/o/{org}` and `/o/{org}/w/{ws}`; New docket's drafts are under
 * `/a/{acct}/dockets/new`, where they were `/o/{org}/workspaces/new`. Every
 * old page address keeps working: it answers a permanent redirect to its new
 * one, with its query. Only pages move. The CLI's `/api/o/{org}/...`, the org
 * admin API's `/api/admin/o/{org}/...` and every MCP address stay as they are.
 */

const OLD_ACCOUNT = /^\/o\/([^/]+)(\/.*)?$/

/** The new address of an old page path, or null when the path is not an old one. */
export function legacyPath(pathname: string): string | null {
  const old = OLD_ACCOUNT.exec(pathname)
  if (!old) return null
  const rest = (old[2] ?? '').replace(/^\/w(?=\/|$)/, '/d').replace(/^\/workspaces(?=\/|$)/, '/dockets')
  return `/a/${old[1]}${rest}`
}

/**
 * The redirect an old page address answers: 308, so a form posted to an old
 * address is posted again, unchanged, to the new one.
 */
export function legacyRedirect(url: URL): Response | null {
  const moved = legacyPath(url.pathname)
  if (moved === null) return null
  return new Response(null, { status: 308, headers: { location: `${moved}${url.search}`, 'cache-control': 'no-store' } })
}
