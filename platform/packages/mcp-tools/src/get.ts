// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'
import { GET_DEFINITION, RESOURCE_SCHEMA, resourceAnswer, type PendingView, type ResourceRead } from '@chrisjowen/docket/mcp/surface'
import {
  cloudResolvedConfig,
  currentRecord,
  describeResource,
  documentHistory,
  frontmatterOf,
  listDocuments,
  liveSupersessions,
  openProposals,
  orgTrust,
  publishedOntology,
  readDocument,
  validate,
  type OpenedDocument,
  type StoreContext,
  type TrustedSource,
} from '@docket/platform-canonical-store'

import { argumentsOf, failed, type CloudTool, type CloudToolContext } from './context.js'

/** `docket_get`'s `structuredContent.schema`. */
export { RESOURCE_SCHEMA }

/**
 * The documents that declare `id`, read as a canonical source of their own,
 * so validation merges just them, scored with what the org attests.
 */
async function resourceSource(ctx: StoreContext, workspaceId: string, opened: readonly (OpenedDocument | null)[]): Promise<TrustedSource> {
  const head = await publishedOntology(ctx, workspaceId)
  const trust = await orgTrust(ctx)
  return {
    resolved: cloudResolvedConfig(workspaceId),
    async trust() {
      return trust
    },
    async ontology() {
      if (!head) throw new Error('This workspace has no published ontology yet.')
      return { text: head.text, revision: head.revision }
    },
    async *documents() {
      for (const document of opened) {
        if (!document) continue
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    },
  }
}

export function getTool(context: CloudToolContext): CloudTool {
  const tool: Tool = {
    definition: GET_DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_get', raw, ['id'], '{ "id": "..." }')
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!id || id.length > 200) throw new InvalidArgumentsError('Give the id of a resource, as docket_search returns it.')

      const found = await context.inTenant(async (ctx) => {
        const records = (await listDocuments(ctx.tx, context.workspaceId)).filter((record) => record.resourceId === id)
        if (records.length === 0) return null
        const opened: (OpenedDocument | null)[] = []
        for (const record of records) opened.push(await readDocument(ctx, context.workspaceId, record.path))
        const read = await validate({ source: await resourceSource(ctx, context.workspaceId, opened) })
        const history = await Promise.all(
          records.map(async (record) =>
            (await documentHistory(ctx, context.workspaceId, record.id)).map((revision) => ({
              path: record.path,
              revision: revision.revision,
              hash: revision.hash,
              createdBy: revision.createdBy,
              createdAt: revision.createdAt.toISOString(),
            })),
          ),
        )
        // A frontmatter `summary` (written by consolidation) is shown when any declaring document has one
        const summary = opened
          .map((document) => frontmatterOf(document?.raw).summary)
          .find((value): value is string => typeof value === 'string' && value.trim() !== '')
          ?.trim()
        // Whether it has gone out of date, the records it replaced, and the proposals not yet fact that touch it.
        const supersessions = new Map((await liveSupersessions(ctx, context.workspaceId)).map((each) => [each.resourceId, each]))
        const own = supersessions.get(id)
        const currentId = own ? currentRecord(supersessions, id) : null
        const current = currentId && !supersessions.has(currentId) ? await describeResource(ctx, context.workspaceId, currentId) : null
        const supersedes = [...supersessions.values()].filter((each) => each.supersededBy === id)
        const pending = (await openProposals(ctx, context.workspaceId)).filter((each) => each.id === id || each.by === id)
        return { records, read, history: history.flat(), summary, own, current: current && currentId ? { id: currentId, ...current } : null, supersedes, pending }
      })
      if (!found) return failed(`There is no resource ${id} in this workspace. Call docket_search to find ids.`)

      const { records, read, history, summary, own, current, supersedes, pending } = found
      const view = (each: (typeof pending)[number]): PendingView => ({
        proposal: each.proposal,
        by: each.by,
        reason: each.reason,
        score: each.score,
        threshold: each.threshold,
        stale: each.stale,
      })
      const replacement = pending.find((each) => each.id === id)
      const replaces = pending.filter((each) => each.by === id)
      const resource: ResourceRead = {
        id,
        viewer: `${context.viewer}#${encodeURIComponent(id)}`,
        entity: read.entities.find((candidate) => candidate.id === id) ?? null,
        ...(summary ? { summary } : {}),
        documents: records.map((record) => ({
          path: record.path,
          origin: record.origin,
          revision: record.revision,
          hash: record.hash,
          updatedBy: record.createdBy,
          updatedAt: record.createdAt.toISOString(),
        })),
        history,
        diagnostics: read.diagnostics,
        ...(own
          ? {
              superseded: {
                own: {
                  supersededBy: own.supersededBy,
                  validUntil: own.validUntil,
                  reason: own.reason,
                  source: own.source,
                  recordedBy: own.actorLabel,
                  evidence: own.evidence,
                },
                current,
              },
            }
          : {}),
        supersedes: supersedes.map((each) => ({ id: each.resourceId, validUntil: each.validUntil, reason: each.reason })),
        ...(replacement ? { pendingReplacement: view(replacement) } : {}),
        ...(replaces.length ? { pendingReplaces: replaces.map((each) => ({ ...view(each), id: each.id })) } : {}),
      }
      return resourceAnswer(resource)
    },
  }
  return { scope: 'docket:read', tool }
}
