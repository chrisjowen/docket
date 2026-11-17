import { InvalidArgumentsError, validate, type CanonicalSource, type MemoryEntity, type Tool } from '@chrisjowen/docket'

import { documentHistory, listDocuments, readDocument, type OpenedDocument } from '../../postgres/documents.js'
import { publishedOntology, workspaceResolvedConfig } from '../../postgres/source.js'
import { liveSupersessions } from '../../postgres/supersession.js'
import { describeResource } from '../../postgres/write.js'
import type { StoreContext } from '../../ports.js'
import { changeNote, currentRecord, dayOf } from '../../supersession.js'
import { splitDocument } from '../../write/document.js'
import { argumentsOf } from '../args.js'
import { failed, UNTRUSTED_NOTE, type ServerTool, type ToolContext } from '../context.js'

type MemoryEvidence = MemoryEntity['evidence'][number]

/** `docket_get`'s `structuredContent.schema`. */
export const RESOURCE_SCHEMA = 'docket-resource.v1'

const DEFINITION = {
  name: 'docket_get',
  title: 'Read one resource',
  description:
    "Read one resource of this workspace's docket by its id (for example service.orders): its merged frontmatter and " +
    'body, its links, every piece of evidence with the confidence it supports, the documents that declare it, and ' +
    'their revision history, and whether it has gone out of date: the record that superseded it, since when and why. ' +
    'Call docket_search first to find ids.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id, as docket_search returns it.' } },
    required: ['id'],
    additionalProperties: false
  },
  annotations: { title: 'Read one resource', readOnlyHint: true, idempotentHint: true, openWorldHint: false }
}

/** Who saw a piece of evidence and where, as one short line. */
function evidenceLine(evidence: MemoryEvidence): string {
  const where = [evidence.repository, evidence.path, evidence.lines ? `L${evidence.lines}` : null, evidence.symbol, evidence.endpoint, evidence.key, ...(evidence.urls ?? [])]
    .filter(Boolean)
    .join(' ')
  const who = [evidence.observedBy ? `observed by ${evidence.observedBy}` : null, evidence.observedAt ? `at ${evidence.observedAt}` : null].filter(Boolean).join(' ')
  return `- ${evidence.source}${where ? `: ${where}` : ''}${who ? ` (${who})` : ''}${evidence.note ? ` - ${evidence.note.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`
}

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
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_get', raw, ['id'], '{ "id": "..." }')
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!id || id.length > 200) throw new InvalidArgumentsError('Give the id of a resource, as docket_search returns it.')

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
      const entity = read.entities.find((candidate) => candidate.id === id) ?? null
      const documents = records.map((record) => ({
        path: record.path,
        origin: record.origin,
        revision: record.revision,
        hash: record.hash,
        updatedBy: record.createdBy,
        updatedAt: record.createdAt.toISOString()
      }))
      const diagnostics = read.diagnostics.map((diagnostic) => ({ severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message }))
      const structured = {
        schema: RESOURCE_SCHEMA,
        id,
        viewer: `${context.viewer}#${encodeURIComponent(id)}`,
        resource: entity
          ? {
              type: entity.type,
              title: entity.title,
              tags: entity.tags,
              attributes: entity.attributes,
              body: entity.content,
              ...(summary ? { summary } : {}),
              confidence: entity.confidence,
              basis: entity.basis,
              evidenceCount: entity.evidenceCount,
              evidence: entity.evidence,
              links: entity.links.map((link) => ({
                rel: link.rel,
                target: link.target,
                ...(link.attributes ? { attributes: link.attributes } : {}),
                confidence: link.confidence,
                basis: link.basis,
                evidence: link.evidence
              })),
              ...(entity.provenance ? { provenance: entity.provenance } : {})
            }
          : null,
        ...(own
          ? {
              superseded: {
                by: own.supersededBy,
                current: current?.id ?? null,
                validUntil: own.validUntil.toISOString(),
                reason: own.reason,
                source: own.source,
                recordedBy: own.actorLabel,
                evidence: own.evidence
              }
            }
          : {}),
        ...(supersedes.length
          ? { supersedes: supersedes.map((each) => ({ id: each.resourceId, validUntil: each.validUntil.toISOString(), reason: each.reason })) }
          : {}),
        documents,
        history,
        diagnostics
      }

      const lines = [UNTRUSTED_NOTE, '']
      if (own) {
        lines.push(changeNote({ id, title: entity?.title ?? id }, current, own), 'It is kept on file for its history; do not present it as current.', '')
      }
      if (supersedes.length) {
        lines.push(`Current record: it supersedes ${supersedes.map((each) => `${each.resourceId} (since ${dayOf(each.validUntil)})`).join(', ')}.`, '')
      }
      if (entity) {
        lines.push(`${entity.id} (${entity.type}) "${entity.title}": confidence ${entity.confidence} (${entity.basis}, ${entity.evidenceCount} evidence)`)
        lines.push(`Declared in: ${documents.map((document) => `${document.path} (${document.origin}, revision ${document.revision})`).join('; ')}`)
        if (Object.keys(entity.attributes).length > 0) lines.push(`Attributes: ${JSON.stringify(entity.attributes)}`)
        if (entity.links.length > 0) {
          lines.push('', 'Links:')
          for (const link of entity.links) lines.push(`- ${link.rel} -> ${link.target} (confidence ${link.confidence})`)
        }
        if (entity.evidence.length > 0) {
          lines.push('', 'Evidence:')
          for (const evidence of entity.evidence) lines.push(evidenceLine(evidence))
        }
        if (summary) lines.push('', 'Summary:', summary)
        if (entity.content.trim()) lines.push('', 'Body:', entity.content.trim())
      } else {
        lines.push(`${id} is declared in ${documents.map((document) => document.path).join(', ')}, but its documents do not validate:`)
        for (const diagnostic of diagnostics) lines.push(`- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
      }
      lines.push('', `${history.length} ${history.length === 1 ? 'revision' : 'revisions'} on record.`)
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured }
    }
  }
  return { scope: 'docket:read', tool }
}
