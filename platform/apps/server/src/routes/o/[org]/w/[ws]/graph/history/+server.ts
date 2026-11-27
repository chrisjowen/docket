// SPDX-License-Identifier: AGPL-3.0-only
import { listDocuments, listIngests } from '@docket/platform-canonical-store'
import { json } from '@sveltejs/kit'

import type { GraphHistory } from '$lib/graph/browse'

import { ACTIVITY_SHOWN, activityEntries } from '$lib/server/activity'
import { authorise } from '$lib/server/request'
import { activityActors, actorNames, inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * What the graph tab's timeline and evidence views read besides the graph:
 * the activity log's newest changes and where each document came from. The
 * page asks for it only while one of those views is open.
 */
export const GET: RequestHandler = async (event) => {
  const read = await inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, 'graph.read')
      return {
        access,
        events: await listIngests(ctx, { workspaceId: workspace.id, limit: ACTIVITY_SHOWN }),
        records: await listDocuments(ctx.tx, workspace.id),
      }
    },
    { api: true },
  )
  const name = await actorNames(read.access)
  const display = activityActors(name)
  const history: GraphHistory = {
    activity: activityEntries(read.events, display),
    documents: read.records.map((record) => ({
      path: record.path,
      origin: record.origin,
      originRef: record.originRef,
      revision: record.revision,
      createdBy: name(record.createdBy),
      createdAt: record.createdAt.toISOString(),
    })),
  }
  return json(history, { headers: { 'cache-control': 'no-store' } })
}
