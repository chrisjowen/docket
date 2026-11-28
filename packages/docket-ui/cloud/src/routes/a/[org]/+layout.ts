// SPDX-License-Identifier: AGPL-3.0-only
import { call, refused } from '$lib/api'
import { accountOf } from '$lib/views'

import type { LayoutLoad } from './$types'

/** The account's sidebar (`accounts.navigation`), as the server's account layout gives its pages. */
export const load: LayoutLoad = async ({ fetch, params, url }) => {
  try {
    return accountOf(await call(fetch, 'accounts.navigation', { params: { acct: params.org } }))
  } catch (cause) {
    refused(cause, url)
  }
}
