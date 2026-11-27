// SPDX-License-Identifier: AGPL-3.0-only
import { countDocuments, listIngests, listWorkspaces } from '@docket/platform-canonical-store'
import { summarise } from '@docket/platform-tenancy'

import { standingOf } from '$lib/docket'
import { readsDocket, seesDocket } from '$lib/server/request'
import { spaceAccess } from '$lib/server/spaces'
import { inOrg } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

/**
 * A space's Dockets (tenancy v2 §2): every docket in it the member may see,
 * with its documents and when it last had a filing; what the member may do
 * on the space, and whether they may add a docket here.
 */
export const load: PageServerLoad = async (event) => {
  const { access, space, caps } = await spaceAccess(event)
  const now = new Date()
  const inSpace = await inOrg(access, async (ctx) => {
    const rows = []
    for (const workspace of (await listWorkspaces(ctx.tx)).filter((each) => each.spaceId === space.id && seesDocket(access, each.id))) {
      const open = readsDocket(access, workspace.id)
      const last = open ? ((await listIngests(ctx, { workspaceId: workspace.id, limit: 1, detail: false }))[0]?.createdAt ?? null) : null
      rows.push({
        slug: workspace.slug,
        name: workspace.name,
        open,
        documents: open ? await countDocuments(ctx.tx, workspace.id) : null,
        standing: open ? standingOf(last, now) : null,
        updatedAt: open ? (last ?? workspace.createdAt).toISOString() : null,
      })
    }
    return rows
  })
  return {
    // Not `dockets`: the org layout's list, which the sidebar reads, keeps that name.
    inSpace,
    you: access.owner ? 'Owner' : summarise(caps).label,
  }
}
