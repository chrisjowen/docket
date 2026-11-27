// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, docketPlace, placeKey } from '@docket/platform-tenancy'

import { grantActions, placeNames } from '$lib/server/grants'
import { placeAccess } from '$lib/server/place-access'
import { docketAccess } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * A docket's Access tab (tenancy v2 §3, §8): what you may do here and why.
 * Whoever manages access here (or system accounts) also sees everyone who
 * reaches it - from a grant on the docket, its space, the whole account, or
 * everyone - with why, and gives, adjusts and removes the grants on this
 * docket. A role on the space is changed on the space's page, and one on the
 * account on the Users page.
 */
export const load: PageServerLoad = async (event) => {
  const { access, workspace } = await docketAccess(event)
  const here = docketPlace(workspace.id)
  const names = await placeNames(access.org.id)
  const page = await placeAccess({ access, here, caps: access.caps, names })
  return {
    ...page,
    onDocket: page.onHere,
    place: { key: placeKey(here), label: `${workspace.name} (docket)` },
    accountPlace: placeKey(ACCOUNT),
  }
}

// Every change here is to a grant on this docket, by someone who may read it: the docket is checked first,
// and its access reused for the change itself rather than read from the platform a second time.
export const actions: Actions = grantActions({
  at: async (event) => {
    const { access, workspace } = await docketAccess(event)
    return { access, place: docketPlace(workspace.id) }
  },
})
