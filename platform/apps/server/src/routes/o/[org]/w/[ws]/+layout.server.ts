// SPDX-License-Identifier: AGPL-3.0-only
import { countDocuments } from '@docket/platform-canonical-store'
import { headOf, listDrafts } from '@docket/platform-ontology-service'
import { CAPABILITIES } from '@docket/platform-tenancy'

import { actorNames, inWorkspace } from '$lib/server/workspace'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async (event) => {
  const summary = await inWorkspace(event, async ({ access, workspace, ctx }) => ({
    access,
    workspace,
    head: await headOf(ctx.tx, workspace.id),
    drafts: (await listDrafts(ctx.tx, workspace.id)).length,
    documents: await countDocuments(ctx.tx, workspace.id),
  }))
  const name = await actorNames(summary.access)
  return {
    /** What the member may do on this docket, capability by capability: every grant that covers it (tenancy v2 §3.1). */
    here: Object.fromEntries(CAPABILITIES.map((cap) => [cap, summary.access.caps.has(cap)])) as Record<(typeof CAPABILITIES)[number], boolean>,
    workspace: {
      id: summary.workspace.id,
      slug: summary.workspace.slug,
      name: summary.workspace.name,
      openedAt: summary.workspace.createdAt.toISOString(),
      documents: summary.documents,
      drafts: summary.drafts,
      head: summary.head
        ? {
            number: summary.head.number ?? 0,
            publishedAt: summary.head.publishedAt?.toISOString() ?? null,
            publishedBy: name(summary.head.publishedBy),
            message: summary.head.message,
          }
        : null,
    },
  }
}
