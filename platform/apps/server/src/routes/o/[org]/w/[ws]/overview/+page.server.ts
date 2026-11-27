// SPDX-License-Identifier: AGPL-3.0-only
import { mcpResourceUrl } from '@docket/platform-auth'
import { listIngests, workspaceGraph } from '@docket/platform-canonical-store'

import { typeCode } from '$lib/docket'
import { exhibitsOf } from '$lib/graph/browse'
import { countBy, typeSlots } from '$lib/graph/model'
import { factNotes } from '$lib/graph/notes'
import { authorise } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { activityActors, actorNames, inWorkspace } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

/** Latest filings the overview lists. */
const FILINGS_SHOWN = 6
/** Weak findings the overview lists as needing corroboration. */
const CORROBORATE_SHOWN = 4

/**
 * A docket's overview: its key figures, its records by type, what is filed
 * most recently, the findings that need corroborating, how far its stores have
 * caught up and how to connect a client. Everything comes from the graph and
 * the activity log the docket's other pages already read.
 */
export const load: PageServerLoad = async (event) => {
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    return {
      access,
      graph: await workspaceGraph(ctx, workspace, { root: `/o/${access.org.slug}/w/${workspace.slug}` }),
      filings: await listIngests(ctx, { workspaceId: workspace.id, limit: FILINGS_SHOWN, detail: false }),
      endpoint: mcpResourceUrl(getRuntime().origin, access.org.slug, workspace.slug),
    }
  })
  const { graph } = read
  const display = activityActors(await actorNames(read.access))
  const titles = new Map(graph.entities.map((entity) => [entity.id, entity.title]))
  const assessed = graph.entities.flatMap((entity) => (entity.assessment ? [{ entity, assessment: entity.assessment }] : []))
  const slots = typeSlots(graph.entities)
  // The findings the Facts view spots as weak: under half weight, or the ontology's default alone.
  const notes = factNotes(graph)
  const weak = notes.filter((note) => note.row.weak)

  return {
    figures: {
      records: graph.entities.length,
      findings: notes.length,
      // Every exhibit the Exhibits view numbers: a record's own and its relations'.
      exhibits: exhibitsOf(graph).length,
      weight: assessed.length ? assessed.reduce((sum, { assessment }) => sum + assessment.confidence, 0) / assessed.length : null,
    },
    // The ontology's bands, which the figures and weight bars classify by.
    bands: graph.trust.bands,
    types: [...countBy(graph.entities, (entity) => entity.type).entries()]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([type, count]) => ({ type, code: typeCode(type), count, slot: slots.get(type) ?? 0 })),
    corroborate: [...weak]
      .sort((a, b) => (a.row.confidence ?? 0) - (b.row.confidence ?? 0) || (a.no < b.no ? -1 : 1))
      .slice(0, CORROBORATE_SHOWN)
      .map(({ no, headline, row, exhibits, standing }) => ({
        no,
        headline,
        re: { id: row.entity.id, title: row.entity.title, code: typeCode(row.entity.type), slot: slots.get(row.entity.type) ?? 0 },
        confidence: row.confidence ?? null,
        unevidenced: row.basis === 'unevidenced',
        exhibits: exhibits.length,
        standing: standing.label,
      })),
    uncorroborated: weak.length,
    filings: read.filings.map((filing) => ({
      id: filing.id,
      at: filing.createdAt.toISOString(),
      channel: filing.channel,
      action: filing.action,
      actor: display(filing.actor, filing.actorLabel),
      outcome: filing.outcome,
      evidenceCount: filing.evidenceCount,
      records: [...new Set(filing.documents.map((document) => document.resourceId).filter((id): id is string => Boolean(id)))]
        .slice(0, 3)
        .map((id) => ({ id, title: titles.get(id) ?? id })),
      documents: filing.documents.length,
    })),
    index: {
      synced: graph.index.synced,
      behind: graph.index.behind,
      stores: graph.index.instances.map((instance) => ({
        id: instance.id,
        behind: instance.behind,
        synced: instance.synced,
        syncedAt: instance.syncedAt,
        failures: instance.failures,
      })),
    },
    endpoint: read.endpoint,
  }
}
