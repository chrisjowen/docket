// SPDX-License-Identifier: AGPL-3.0-only
import { HISTORY_DAYS, HISTORY_LIMIT, listQueryTraces } from '@docket/platform-canonical-store'

import { error } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { actorNames, inWorkspace } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

/** Traces the page replays. */
const TRACES_SHOWN = 50

/**
 * Settings → Queries: the workspace's recent questions replayed step by step,
 * read-only - what the documents held, which stores were asked and what each
 * returned, the query each ran and who wrote it, what went into the answer and
 * what it cost. Owners and admins see every question asked of the workspace;
 * every other member sees only the questions they asked, through any of their
 * tokens or OAuth clients.
 */
export const load: PageServerLoad = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Sign in first.')
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    const everyone = access.can('audit')
    return { access, everyone, traces: await listQueryTraces(ctx, workspace.id, { limit: TRACES_SHOWN, ...(everyone ? {} : { askedBy: user.id }) }) }
  })
  const name = await actorNames(read.access)
  // A member reads as @login; through a token or connection, by its name too.
  const who = (actor: string) => name(actor)
  return {
    kept: { limit: HISTORY_LIMIT, days: HISTORY_DAYS },
    everyone: read.everyone,
    traces: read.traces.map((trace) => ({
      id: trace.id,
      at: trace.at.toISOString(),
      tool: trace.tool,
      actor: who(trace.actor),
      outcome: trace.outcome,
      durationMs: trace.durationMs,
      costUsd: trace.costUsd,
      detail: trace.detail,
      detailError: trace.detailError ?? null,
    })),
  }
}
