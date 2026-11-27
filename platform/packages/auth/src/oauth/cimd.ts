// SPDX-License-Identifier: AGPL-3.0-only
import { isIP } from 'node:net'

/**
 * Client ID Metadata Documents (§8.2): a client's id is an https URL whose
 * document describes it, fetched when the client first appears. The fetch is
 * guarded against SSRF: https only on the default port, no credentials in the
 * URL, no IP literals, no loopback, link-local, cluster or private names.
 * `oidc-provider` adds its own guards underneath: a 2.5 s timeout, no
 * redirects, a body cap (64 KB here), and a connect-time refusal of any
 * address in a special-use range, so a public name that resolves to a
 * private address is refused too.
 */

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.svc', '.cluster.local', '.lan', '.home.arpa']

export function cimdFetchAllowed(clientId: string): boolean {
  if (clientId.length > 2_048) return false
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false
  if (url.port !== '' && url.port !== '443') return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false
  if (!host.includes('.') || host === 'localhost') return false
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  return true
}

/** Where a redirect URI sends the code: its host, which the consent screen shows prominently. */
export function redirectHost(uri: string): string {
  try {
    const url = new URL(uri)
    return url.host || url.protocol.replace(/:$/, '')
  } catch {
    return uri
  }
}

/**
 * Whether a redirect goes to the user's own machine: a loopback address or a
 * custom scheme. Any local program can claim such a redirect, so a client
 * whose metadata names one could be an impostor using another client's
 * metadata URL; the consent screen flags it as a local app.
 */
export function isLocalRedirect(uri: string): boolean {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return true
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)
  } catch {
    return true
  }
}

/** Whether a client id is a metadata document URL rather than a registered (DCR) id. */
export function isMetadataClientId(clientId: string): boolean {
  return /^https:\/\//i.test(clientId)
}
