// SPDX-License-Identifier: AGPL-3.0-only
import { call, refused } from '$lib/api'
import { docketOf } from '$lib/views'

import type { LayoutLoad } from './$types'

/** The docket's header (`dockets.get`, `dockets.summary`), as the server's docket layout gives its pages. */
export const load: LayoutLoad = async ({ fetch, params, url }) => {
  const docket = { acct: params.acct, docket: params.docket }
  try {
    const [found, summary] = await Promise.all([call(fetch, 'dockets.get', { params: docket }), call(fetch, 'dockets.summary', { params: docket })])
    return docketOf(found, summary)
  } catch (cause) {
    refused(cause, url)
  }
}
