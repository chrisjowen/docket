// SPDX-License-Identifier: AGPL-3.0-only
import { normaliseLogin } from '@docket/platform-tenancy'

/** A comma-separated list of GitHub logins, lowercase (`DOCKET_PLATFORM_ADMINS`); one that is not a login stops the server starting. */
export function loginList(name: string, raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((login) => login.trim())
    .filter(Boolean)
    .map((login) => {
      const normal = normaliseLogin(login)
      if (!normal) throw new Error(`${name} lists GitHub logins, and ${JSON.stringify(login)} is not one`)
      return normal
    })
}
