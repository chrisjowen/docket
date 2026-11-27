// SPDX-License-Identifier: AGPL-3.0-only
import { capFlags, spaceAccess, spaceView } from '$lib/server/spaces'

import type { LayoutServerLoad } from './$types'

/** A space's pages (tenancy v2 §2): the space, and what the member may do on it. */
export const load: LayoutServerLoad = async (event) => {
  const { space, caps } = await spaceAccess(event)
  return {
    space: spaceView(space),
    /** What the member may do on this space, capability by capability: every grant that covers it. */
    onSpace: capFlags(caps),
  }
}
