// SPDX-License-Identifier: AGPL-3.0-only
import { indexStatus, listIngests, optionalStatus, postgresSource, requestRecheck, validate } from '@docket/platform-canonical-store'

import { authorise, recordAudit } from '$lib/server/request'
import { HISTORY_SHOWN, syncLive } from '$lib/server/sync-status'
import { actorNames, inWorkspace } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * Settings → Sync: how the workspace's documents reach its stores, read-only.
 * Each store's standing - when it last caught up, how far it lags, its
 * failures - and the recent history: every document change and every pass
 * that projected them, with what each changed. Members see it; only owners
 * may ask for a re-check, and nobody changes a store from here. The documents
 * are read and validated here, on load, for each store's lag; the page then
 * follows the rest of the standing through `./status`, which opens none of them.
 */
export const load: PageServerLoad = async (event) => {
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'graph.read')
    const validation = await validate({ source: postgresSource(ctx, workspace.id) })
    const broken = new Set(validation.diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : [])))
    const statusRead = { entities: validation.entities, documents: validation.documents, broken }
    const live = await syncLive(ctx.tx, workspace.id)
    const index = await indexStatus(ctx.tx, workspace.id, statusRead)
    const optional = live.stores.filter((store) => store.optional).map((store) => store.id)
    return {
      access,
      entities: validation.entities,
      documents: validation.documents.length,
      unreadable: validation.diagnostics.filter((d) => d.severity === 'error').length,
      index: { ...index, instances: [...index.instances, ...(optional.length ? await optionalStatus(ctx.tx, workspace.id, statusRead, optional) : [])] },
      live,
      ingests: await listIngests(ctx, { workspaceId: workspace.id, limit: HISTORY_SHOWN }),
    }
  })
  const name = await actorNames(read.access)
  const titles = new Map(read.entities.map((entity) => [entity.id, entity.title]))
  return {
    canRecheck: read.access.can('org.administer'),
    documents: {
      documents: read.documents,
      exhibits: read.entities.length,
      unreadable: read.unreadable,
      failures: read.ingests.filter((entry) => entry.outcome === 'refused' || entry.outcome === 'error').length,
    },
    live: {
      ...read.live,
      stores: read.live.stores.map((store) => {
        const status = read.index.instances.find((instance) => instance.id === store.id)
        return { ...store, synced: status?.synced ?? null, behind: status?.behind ?? null }
      }),
      runs: read.live.runs.map((run) => ({
        ...run,
        instances: run.instances.map((instance) => ({
          ...instance,
          changes: instance.changes.map((change) => ({ ...change, title: change.kind === 'entity' ? (titles.get(change.id) ?? null) : null })),
        })),
      })),
    },
    ingests: read.ingests.map((entry) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      channel: entry.channel,
      action: entry.action,
      actor: entry.actor.startsWith('user:') && name(entry.actor) !== entry.actor ? name(entry.actor) : entry.actorLabel,
      outcome: entry.outcome,
      documents: entry.documents.map((document) => ({ path: document.path, resourceId: document.resourceId, change: document.change })),
    })),
  }
}

export const actions: Actions = {
  /**
   * Asks the worker to check the stores against the documents now, for owners
   * (Settings → Sync): a pass outside the backoff, which projects only what
   * the documents and manifests say is missing. It changes nothing a pass
   * would not; a rebuild, on the graph page, is what clears and replays them.
   */
  recheck: (event) =>
    inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'org.administer')
      await requestRecheck(ctx.tx, workspace.id)
      await recordAudit(ctx.tx, event, { action: 'projections.recheck', orgId: access.org.id, workspaceId: workspace.id })
      return { flash: 'Re-check requested: the worker compares each store with the documents and catches up anything missing.' }
    }),
}
