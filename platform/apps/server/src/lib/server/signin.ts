// SPDX-License-Identifier: AGPL-3.0-only
/** The cookie that carries GitHub sign-in's state and PKCE verifier between redirect and callback. */
export const OAUTH_COOKIE = 'docket_oauth'
/** The cookie that carries an OIDC sign-in's provider, state, nonce and PKCE verifier between redirect and callback. */
export const OIDC_COOKIE = 'docket_oidc'
/** The cookie that remembers a GitHub identity not on the beta list, for the request-access form. */
export const PENDING_COOKIE = 'docket_pending'

/** A same-site path to return to after sign-in; anything else becomes `/`. */
export function safeNext(next: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(next)) return '/'
  return next
}
