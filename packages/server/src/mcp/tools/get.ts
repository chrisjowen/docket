import { validate, type CanonicalSource, type Tool } from '@chrisjowen/docket'

import { GET_DEFINITION, RESOURCE_SCHEMA, currentRecord, getArguments, resourceAnswer, splitDocument } from '../../docket.js'
import { documentHistory, listDocuments, readDocument, type OpenedDocument } from '../../postgres/documents.js'
import { publishedOntology, workspaceResolvedConfig } from '../../postgres/source.js'
import { liveSupersessions } from '../../postgres/supersession.js'
import { describeResource } from '../../postgres/write.js'
import type { StoreContext } from '../../ports.js'
import { failed, type ServerTool, type ToolContext } from '../context.js'

export { RESOURCE_SCHEMA }

/** A document's whole frontmatter, including fields the document model does not carry; empty when it has none that parses. */
function frontmatterOf(raw: string | undefined): Record<string, unknown> {
  const parts = raw === undefined ? null : splitDocument(raw)
  const data: unknown = parts?.frontmatter.toJS()
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

/** The documents that declare `id`, read as a canonical source of their own, so validation merges just them. */
async function resourceSource(ctx: StoreContext, workspaceId: string, opened: readonly (OpenedDocument | null)[]): Promise<CanonicalSource> {
  const head = await publishedOntology(ctx, workspaceId)
  return {
    resolved: workspaceResolvedConfig(workspaceId),
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
    }
  }
}

export function getTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: GET_DEFINITION,
    async call(raw) {
      const { id } = getArguments(raw)

      const found = await context.store.run(async (ctx) => {
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
              createdAt: revision.createdAt.toISOString()
            }))
          )
        )
        // A frontmatter `summary` (written by consolidation) is shown when any declaring document has one
        const summary = opened
          .map((document) => frontmatterOf(document?.raw).summary)
          .find((value): value is string => typeof value === 'string' && value.trim() !== '')
          ?.trim()
        // Whether it has gone out of date, and the records it replaced.
        const supersessions = new Map((await liveSupersessions(ctx, context.workspaceId)).map((each) => [each.resourceId, each]))
        const own = supersessions.get(id)
        const currentId = own ? currentRecord(supersessions, id) : null
        const current = currentId && !supersessions.has(currentId) ? await describeResource(ctx, context.workspaceId, currentId) : null
        const supersedes = [...supersessions.values()].filter((each) => each.supersededBy === id)
        return { records, read, history: history.flat(), summary, own, current: current && currentId ? { id: currentId, ...current } : null, supersedes }
      })
      if (!found) return failed(`There is no resource ${id} in this workspace. Call docket_search to find ids.`)

      const { records, read, history, summary, own, current, supersedes } = found
      return resourceAnswer({
        id,
        viewer: context.viewer,
        entity: read.entities.find((candidate) => candidate.id === id) ?? null,
        ...(summary ? { summary } : {}),
        documents: records.map((record) => ({
          path: record.path,
          origin: record.origin,
          revision: record.revision,
          hash: record.hash,
          updatedBy: record.createdBy,
          updatedAt: record.createdAt.toISOString()
        })),
        history,
        diagnostics: read.diagnostics,
        ...(own
          ? {
              superseded: {
                own: { supersededBy: own.supersededBy, validUntil: own.validUntil, reason: own.reason, source: own.source, recordedBy: own.actorLabel, evidence: own.evidence },
                current
              }
            }
          : {}),
        supersedes: supersedes.map((each) => ({ id: each.resourceId, validUntil: each.validUntil, reason: each.reason }))
      })
    }
  }
  return { scope: 'docket:read', tool }
}
