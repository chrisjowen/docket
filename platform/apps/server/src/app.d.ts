// SPDX-License-Identifier: AGPL-3.0-only
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** Correlates the request's audit event and logs. */
      requestId: string
      startedAt: number
      user: import('$lib/server/request').SignedIn | null
      /** The session cookie's secret, which keys the CSRF token. Never sent to the page. */
      sessionSecret: string | null
      csrf: string | null
      /** Set once the request has written its audit event, so the hook does not write a second. */
      audited: boolean
      /** The org a request resolved to, so a fallback audit event lands in that org's log. */
      auditOrgId: string | null
    }
    interface Error {
      message: string
    }
  }
}

export {}
