// SPDX-License-Identifier: AGPL-3.0-only
import { accountMcpUrl } from '@docket/platform-auth'

import { firstDocketOf, settingUp } from '$lib/server/onboarding'
import { getRuntime } from '$lib/server/runtime'

import type { PageServerLoad } from './$types'

/**
 * Signing up, step 5 (tenancy v2 §6): connect an AI client, one of three
 * ways. Signing in from the client (OAuth) is one address for every docket
 * in the account, and the connection is named at sign-in; a personal access
 * token acts as you; a system account's token acts as it.
 */
export const load: PageServerLoad = async (event) => {
  const access = await settingUp(event)
  return {
    endpoint: accountMcpUrl(getRuntime().origin, access.org.slug),
    docket: firstDocketOf(event.url),
  }
}
