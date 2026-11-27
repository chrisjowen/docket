// SPDX-License-Identifier: AGPL-3.0-only
import { normaliseAnyLogin, normaliseEmail } from '@docket/platform-tenancy'

/**
 * A comma-separated list of logins and emails, lowercase (`DOCKET_PLATFORM_ADMINS`):
 * a GitHub login, another provider's login (`jo.okta`), or an email that
 * matches any of a user's verified emails. One that is none of these stops the
 * server starting.
 */
export function loginList(name: string, raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((login) => login.trim())
    .filter(Boolean)
    .map((login) => {
      const normal = login.includes('@') && !login.startsWith('@') ? normaliseEmail(login) : normaliseAnyLogin(login)
      if (!normal) throw new Error(`${name} lists logins and emails, and ${JSON.stringify(login)} is neither`)
      return normal
    })
}
