// SPDX-License-Identifier: AGPL-3.0-only
import { call, refused } from '$lib/api'
import { accessSummary, grantRow, placeLabel } from '$lib/views'

import type { PageLoad } from './$types'

/**
 * The docket's Access tab: what the caller may do here and why (`access.explain`); for whoever manages access
 * or system accounts here, who reaches it (`access.who`), the grants on it (`grants.list`) and the roles to
 * give (`roles.list`).
 */
export const load: PageLoad = async ({ fetch, params, url, depends, parent }) => {
  depends('api:docket-access')
  const acct = { acct: params.org }
  const place = `docket:${params.ws}`
  try {
    const explained = await call(fetch, 'access.explain', { params: acct, query: { place } })
    const you = { summary: accessSummary(explained.owner, explained.caps), caps: explained.caps, because: explained.because }
    const here = { key: place, label: placeLabel(explained.place) }
    const manages = explained.caps.includes('access') || explained.caps.includes('system')
    if (!manages) return { you, manages, here, reach: [], onDocket: [], fromSpace: null, onAccount: [], roles: [], people: [] }
    const [who, grants, roles] = await Promise.all([
      call(fetch, 'access.who', { params: acct, query: { place } }),
      call(fetch, 'grants.list', { params: acct, query: { place } }),
      call(fetch, 'roles.list', { params: acct }),
    ])
    const covering = who.covering.map(grantRow)
    const { workspace } = await parent()
    return {
      you,
      manages,
      here,
      reach: who.reach,
      onDocket: grants.grants.map(grantRow),
      // Grants on the docket's space cover it too; they are changed on the space's own page.
      fromSpace: { slug: workspace.space.slug, name: workspace.space.name, grants: covering.filter((grant) => grant.place.kind === 'space') },
      onAccount: covering.filter((grant) => grant.place.kind === 'account'),
      roles: roles.roles,
      people: who.candidates.map((candidate) => ({ id: candidate.ref, label: candidate.label })),
    }
  } catch (cause) {
    refused(cause, url)
  }
}
