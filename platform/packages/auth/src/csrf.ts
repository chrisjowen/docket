// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * CSRF tokens for every mutating form (§8.1): an HMAC keyed by the session's
 * secret id. Only a page served to the session holder can know it, it needs
 * no storage, and it dies with the session.
 */
export const CSRF_FIELD = 'csrf'
export const CSRF_HEADER = 'x-csrf-token'

export function csrfToken(sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update('docket-cloud csrf v1').digest('base64url')
}

export function verifyCsrf(sessionSecret: string, token: unknown): boolean {
  if (typeof token !== 'string' || !token) return false
  const expected = Buffer.from(csrfToken(sessionSecret))
  const given = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
