// SPDX-License-Identifier: AGPL-3.0-only
import { CHANNELS, ingestActors, listIngests, type Channel } from '@docket/platform-canonical-store'

import { authorise } from '$lib/server/request'
import { activityActors, actorNames, inWorkspace } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

const isChannel = (value: string | null): value is Channel => value !== null && (CHANNELS as readonly string[]).includes(value)

/**
 * The activity log (§14.2, §18): every change to the workspace's knowledge -
 * MCP and web writes, CLI pushes, repo syncs, ontology publishes - with who
 * made it, through which channel, the evidence it added and what the
 * validator said, each linked to its audit event. Filtered by channel and
 * actor.
 */
export const load: PageServerLoad = async (event) => {
  const channelParam = event.url.searchParams.get('channel')
  const channel = isChannel(channelParam) ? channelParam : null
  const actor = event.url.searchParams.get('actor')?.slice(0, 300) || null
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'graph.read')
    return {
      access,
      events: await listIngests(ctx, { workspaceId: workspace.id, limit: 200, ...(channel ? { channel } : {}), ...(actor ? { actor } : {}) }),
      actors: await ingestActors(ctx, workspace.id),
    }
  })
  const display = activityActors(await actorNames(read.access))
  return {
    filters: { channel, actor },
    channels: CHANNELS,
    actors: read.actors.map((entry) => ({ actor: entry.actor, label: display(entry.actor, entry.label) })),
    events: read.events.map((entry) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      channel: entry.channel,
      action: entry.action,
      actor: entry.actor,
      actorLabel: display(entry.actor, entry.actorLabel),
      outcome: entry.outcome,
      documents: entry.documents,
      evidenceCount: entry.evidenceCount,
      resourceId: entry.detail?.resourceId ?? null,
      evidence: entry.detail?.evidence ?? [],
      diagnostics: entry.detail?.diagnostics ?? [],
      reason: entry.detail?.reason ?? null,
      ontology: entry.detail?.ontology ?? null,
      detailError: entry.detailError ?? null,
      requestId: entry.requestId,
    })),
  }
}
