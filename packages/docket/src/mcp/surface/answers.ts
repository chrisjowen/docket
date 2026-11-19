import type { Diagnostic, MemoryEntity, Ontology } from '../../model/index.js'
import type { Disposition, DraftCheck } from '../../workspace/ontology/check.js'
import {
  MigrationInvalid,
  OntologyBreakingChange,
  OntologyInvalid,
  OntologyNarrowingChange,
  OntologyWriteDisabled,
  StaleDraft,
  isBreaking
} from '../../workspace/ontology/errors.js'
import { describeMigration, type Migration } from '../../workspace/ontology/migrations.js'
import type { Origin } from '../../workspace/origin.js'
import { pendingNote, proposalNote, type ProposalStatus } from '../../workspace/proposals.js'
import { changeNote, dayOf } from '../../workspace/supersession.js'
import type { StampedEvidence } from '../../workspace/write/inputs.js'
import { searchText } from '../search.js'
import type { ToolResult } from '../server.js'
import { ONTOLOGY_SCHEMA, PROPOSAL_SCHEMA, PUBLISH_SCHEMA, RESOURCE_SCHEMA, UNTRUSTED_NOTE, annotatedSearchText, failed, type WorkspaceSearch } from './results.js'
import { WRITE_SCHEMA } from './write-args.js'

/*
 * How each tool of the surface answers - its text for the model and its
 * `structuredContent` for a client - from what a store read or wrote, so
 * every Docket MCP server answers alike.
 */

type Brief = Pick<Diagnostic, 'severity' | 'code' | 'message'>
const brief = (diagnostics: readonly Diagnostic[]): Brief[] => diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))

/** A resource's page in the host's graph browser, or null where there is none. */
export const viewerOf = (viewer: string | null, id: string): string | null => (viewer === null ? null : `${viewer}#${encodeURIComponent(id)}`)

/**
 * `docket_search`'s answer. `behind` replaces the advice for an index behind
 * the files, where the host keeps the index itself.
 */
export function searchAnswer(found: WorkspaceSearch, options: { behind?: string } = {}): ToolResult {
  let text = annotatedSearchText(found, searchText(found)).replace(/Read the canonical files above for the full record\.$/, 'Call docket_get with an id for its full record.')
  if (options.behind) text = text.replace(/: run `docket sync`\./, `: ${options.behind}`)
  return { content: [{ type: 'text', text: `${UNTRUSTED_NOTE}\n\n${text}` }], structuredContent: found }
}

/** A document that declares a resource, as `docket_get` lists it. */
export interface ResourceDocument {
  path: string
  origin: Origin
  /** Absent where the store keeps no numbered revisions: a project's own files, whose history is git's. */
  revision?: number
  hash: string
  updatedBy?: string
  updatedAt?: string
}

/** One revision of a declaring document. */
export interface ResourceRevision {
  path: string
  revision: number
  hash: string
  createdBy: string
  createdAt: string
}

/** A live supersession of the resource, as `docket_get` shows it. */
export interface Superseded {
  supersededBy: string
  validUntil: Date | string
  reason: string
  source: string
  recordedBy: string
  evidence: readonly StampedEvidence[]
}

/** What a store read for `docket_get`. */
export interface ResourceRead {
  id: string
  viewer: string | null
  /** The resource as docket's validator merged it; null when its documents do not validate. */
  entity: MemoryEntity | null
  /** A frontmatter `summary` one of its documents holds. */
  summary?: string
  documents: ResourceDocument[]
  history: ResourceRevision[]
  /** How its history reads where the store keeps none: said instead of counting revisions. */
  historyNote?: string
  diagnostics: readonly Diagnostic[]
  /** Its supersession, when it has gone out of date, with the record current now (null when no longer on file). */
  superseded?: { own: Superseded; current: { id: string; title: string } | null }
  /** The records it replaced. */
  supersedes: { id: string; validUntil: Date | string; reason: string }[]
  /** A pending proposal that it is replaced: it is still current until the proposal clears its bar. */
  pendingReplacement?: PendingView
  /** Pending proposals that it replaces records: not yet fact. */
  pendingReplaces?: (PendingView & { id: string })[]
}

/** A pending supersede proposal as a read shows it. */
export interface PendingView {
  proposal: string
  by: string
  reason: string
  score: number
  threshold: number
  stale: boolean
}

const isoOf = (at: Date | string): string => (typeof at === 'string' ? at : at.toISOString())

/** `docket_get`'s answer. */
export function resourceAnswer(read: ResourceRead): ToolResult {
  const { id, entity, summary, documents, history, superseded, supersedes, pendingReplacement, pendingReplaces = [] } = read
  const pendingOf = (pending: PendingView) => ({
    proposal: pending.proposal,
    by: pending.by,
    reason: pending.reason,
    score: pending.score,
    threshold: pending.threshold,
    ...(pending.stale ? { stale: true } : {})
  })
  const diagnostics = brief(read.diagnostics)
  const structured = {
    schema: RESOURCE_SCHEMA,
    id,
    viewer: viewerOf(read.viewer, id),
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
    ...(superseded
      ? {
          superseded: {
            by: superseded.own.supersededBy,
            current: superseded.current?.id ?? null,
            validUntil: isoOf(superseded.own.validUntil),
            reason: superseded.own.reason,
            source: superseded.own.source,
            recordedBy: superseded.own.recordedBy,
            evidence: superseded.own.evidence
          }
        }
      : {}),
    ...(supersedes.length ? { supersedes: supersedes.map((each) => ({ id: each.id, validUntil: isoOf(each.validUntil), reason: each.reason })) } : {}),
    ...(pendingReplacement ? { pendingReplacement: pendingOf(pendingReplacement) } : {}),
    ...(pendingReplaces.length ? { pendingReplaces: pendingReplaces.map((each) => ({ id: each.id, ...pendingOf(each) })) } : {}),
    documents,
    history,
    diagnostics
  }

  const lines = [UNTRUSTED_NOTE, '']
  if (superseded) {
    lines.push(changeNote({ id, title: entity?.title ?? id }, superseded.current, superseded.own), 'It is kept on file for its history; do not present it as current.', '')
  }
  if (supersedes.length) {
    lines.push(`Current record: it supersedes ${supersedes.map((each) => `${each.id} (since ${dayOf(each.validUntil)})`).join(', ')}.`, '')
  }
  if (pendingReplacement) lines.push(pendingNote({ ...pendingReplacement, id: pendingReplacement.proposal }), '')
  if (pendingReplaces.length) {
    lines.push(
      `Pending replacement of ${pendingReplaces.map((each) => `${each.id} (proposal ${each.proposal}, ${each.score.toFixed(2)} of ${each.threshold.toFixed(2)})`).join(', ')}: not yet fact.`,
      ''
    )
  }
  if (entity) {
    lines.push(`${entity.id} (${entity.type}) "${entity.title}": confidence ${entity.confidence} (${entity.basis}, ${entity.evidenceCount} evidence)`)
    lines.push(
      `Declared in: ${documents.map((document) => `${document.path} (${document.origin}${document.revision === undefined ? '' : `, revision ${document.revision}`})`).join('; ')}`
    )
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
  lines.push('', read.historyNote ?? `${history.length} ${history.length === 1 ? 'revision' : 'revisions'} on record.`)
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured }
}

/** Who saw a piece of evidence and where, as one short line. */
function evidenceLine(evidence: MemoryEntity['evidence'][number]): string {
  const where = [evidence.repository, evidence.path, evidence.lines ? `L${evidence.lines}` : null, evidence.symbol, evidence.endpoint, evidence.key, ...(evidence.urls ?? [])]
    .filter(Boolean)
    .join(' ')
  const who = [evidence.observedBy ? `observed by ${evidence.observedBy}` : null, evidence.observedAt ? `at ${evidence.observedAt}` : null].filter(Boolean).join(' ')
  return `- ${evidence.source}${where ? `: ${where}` : ''}${who ? ` (${who})` : ''}${evidence.note ? ` - ${evidence.note.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`
}

/** The published head as `docket_ontology` reads it. */
export interface OntologyHead {
  version: number
  /** `hashContent` of its text. */
  revision: string
  publishedAt: Date | string
  message: string | null
  ontology: Ontology | null
  yaml: string
}

/** `docket_ontology`'s answer. `where` says whose ontology it is, as the text names it. */
export function ontologyAnswer(head: OntologyHead, where = 'this workspace'): ToolResult {
  const structured = {
    schema: ONTOLOGY_SCHEMA,
    version: head.version,
    revision: head.revision,
    publishedAt: isoOf(head.publishedAt),
    message: head.message,
    ontology: head.ontology,
    yaml: head.yaml
  }
  const text = `The published ontology of ${where}, version ${head.version} (${head.revision}):\n\n${head.yaml}`
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

/** `docket_retire`'s answer, from what the store retired and what still declares the resource. */
export function retireAnswer(
  id: string,
  result: { retired: { path: string; revision?: number }[]; remaining: { path: string; origin: Origin }[]; diagnostics: readonly Diagnostic[] }
): ToolResult {
  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
  const lines = errors.length
    ? ['Refused: nothing was retired.', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
    : [`Retired ${id}: ${result.retired.map((document) => document.path).join(', ')}. It leaves search at the next index update.`]
  if (warnings.length) lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`))
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      schema: WRITE_SCHEMA,
      tool: 'docket_retire',
      id,
      ok: errors.length === 0,
      retired: result.retired.map(({ path, revision }) => ({ path, ...(revision !== undefined ? { revision } : {}) })),
      remaining: result.remaining,
      diagnostics: brief(result.diagnostics)
    },
    ...(errors.length ? { isError: true } : {})
  }
}

/** `docket_add_evidence`'s answer for a supersede proposal. */
export function proposalEvidenceAnswer(
  input: { supersession: string },
  viewer: string | null,
  result: { proposal?: ProposalView & { resource: string; supersededBy: string }; changed: boolean; evidenceAdded: number; diagnostics: readonly Diagnostic[] }
): ToolResult {
  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
  const proposal = result.proposal
  const lines =
    errors.length || !proposal
      ? ['Refused: nothing was added. Fix these and call docket_add_evidence again:', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
      : [
          `${result.evidenceAdded ? `Added ${result.evidenceAdded} evidence to` : 'Nothing new for'} proposal ${proposal.id} (${proposal.supersededBy} supersedes ${proposal.resource}). ` +
            proposalNote(proposal.status, { score: proposal.score, threshold: proposal.threshold, clears: proposal.status === 'accepted' }, proposal.carry)
        ]
  if (warnings.length) lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`))
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      schema: WRITE_SCHEMA,
      tool: 'docket_add_evidence',
      supersession: input.supersession,
      ok: errors.length === 0,
      changed: result.changed,
      evidenceAdded: result.evidenceAdded,
      ...(proposal ? { id: proposal.resource, supersededBy: proposal.supersededBy, status: proposal.status, proposal: proposalOf(proposal), viewer: viewerOf(viewer, proposal.resource) } : {}),
      diagnostics: brief(result.diagnostics)
    },
    ...(errors.length ? { isError: true } : {})
  }
}

/** `docket_supersede`'s answer. */
/** A supersede proposal as a write answers it. */
export interface ProposalView {
  id: string
  status: ProposalStatus
  score: number
  threshold: number
  carry: readonly { policy: string; source: string; reaches: number }[]
}

const proposalOf = (proposal: ProposalView) => ({
  id: proposal.id,
  status: proposal.status,
  score: proposal.score,
  threshold: proposal.threshold,
  ...(proposal.carry.length ? { carry: proposal.carry.map(({ policy, source, reaches }) => ({ policy, source, reaches })) } : {})
})

export function supersedeAnswer(
  input: { id: string; by: string },
  viewer: string | null,
  result: {
    changed: boolean
    supersession?: { supersededBy: string; validUntil: Date | string }
    proposal?: ProposalView
    replaced?: string
    diagnostics: readonly Diagnostic[]
  }
): ToolResult {
  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
  const held = result.supersession
  const proposal = result.proposal
  const pending = proposal?.status === 'pending'
  const lines = errors.length
    ? ['Refused: nothing was superseded. Fix these and call docket_supersede again:', ...errors.map((d) => `- ${d.code}: ${d.message}`)]
    : pending && proposal
      ? [
          `${result.changed ? 'Proposed' : 'Already proposed'}: ${input.by} supersedes ${input.id} (proposal ${proposal.id}). ` +
            proposalNote('pending', { score: proposal.score, threshold: proposal.threshold, clears: false }, proposal.carry) +
            ` Until then ${input.id} is current.`
        ]
      : !result.changed
        ? [`Nothing new: ${input.id} is already superseded by ${input.by}.`]
        : [
            `${input.id} is now superseded by ${input.by} since ${held ? dayOf(held.validUntil) : 'now'}. It stays on file with its history; ` +
              'search answers with the replacement and a note of the change.' +
              (proposal ? ` ${proposalNote('accepted', { score: proposal.score, threshold: proposal.threshold, clears: true }, [])}` : '')
          ]
  if (warnings.length) lines.push('', ...warnings.map((d) => `- ${d.code}: ${d.message}`))
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      schema: WRITE_SCHEMA,
      tool: 'docket_supersede',
      id: input.id,
      ok: errors.length === 0,
      changed: result.changed,
      ...(held ? { supersededBy: held.supersededBy, validUntil: isoOf(held.validUntil) } : {}),
      ...(proposal ? { status: proposal.status, proposal: proposalOf(proposal) } : {}),
      ...(result.replaced ? { replaced: result.replaced } : {}),
      viewer: viewerOf(viewer, input.id),
      diagnostics: brief(result.diagnostics)
    },
    ...(errors.length ? { isError: true } : {})
  }
}

/** Why a proposal is not an ontology, for the model to read; no draft was made. */
export function proposalRefusal(caught: unknown): ToolResult | null {
  if (!(caught instanceof OntologyInvalid)) return null
  return failed(`The proposal is not a valid ontology; no draft was made:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`)
}

/** `docket_propose_ontology_change`'s answer. `next` says what happens to the draft now. */
export function proposalAnswer(draftId: string, check: DraftCheck, next: string): ToolResult {
  const lines = [`Draft ${draftId} made against v${check.head}: ${check.classification}.`, `${check.changes.length} change(s); checked against ${check.documents} document(s).`]
  if (check.introduced.length) {
    lines.push('', 'It would give existing documents these diagnostics:', ...check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`))
  }
  if (check.rescored.length) {
    lines.push(
      '',
      `It would re-score ${check.rescored.length} resource(s) and link(s):`,
      ...check.rescored
        .slice(0, 20)
        .map(
          (each) =>
            `- ${each.resourceId}${each.link ? ` ${each.link.rel} -> ${each.link.target}` : ''}: ${each.before} -> ${each.after}${each.bandBefore !== each.bandAfter ? ` (${each.bandBefore} -> ${each.bandAfter})` : ''}`
        )
    )
  }
  if (check.proposals.length) {
    lines.push(
      '',
      'It would decide these supersede proposals differently:',
      ...check.proposals.map((each) =>
        each.change === 'would-accept'
          ? `- ${each.proposal} for ${each.resource}: would be accepted (${each.before.toFixed(2)} -> ${each.after.toFixed(2)} of ${each.threshold.toFixed(2)}).`
          : `- ${each.proposal} for ${each.resource}: would no longer pass (${each.before.toFixed(2)} -> ${each.after.toFixed(2)} of ${each.threshold.toFixed(2)}); it stays accepted, flagged for a person to review.`
      )
    )
  }
  lines.push('', next)
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      schema: PROPOSAL_SCHEMA,
      draftId,
      head: check.head,
      classification: check.classification,
      changes: check.changes,
      introduced: check.introduced.map(({ severity, code, message, id, path }) => ({ severity, code, message, ...(id ? { id } : {}), ...(path ? { path } : {}) })),
      affected: check.affected,
      ...(check.rescored.length ? { rescored: check.rescored } : {}),
      ...(check.proposals.length ? { proposals: check.proposals } : {}),
      unresolved: check.unresolved,
      ontology: brief(check.ontology)
    }
  }
}

/** Why a publish was refused, for the model to read; nothing was published. Null for an error that is not a refusal. */
export function publishRefusal(caught: unknown): ToolResult | null {
  if (caught instanceof OntologyInvalid) {
    return failed(`The change is not a valid ontology; nothing was published:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`)
  }
  if (caught instanceof OntologyWriteDisabled) return failed(`Nothing was published: ${caught.message}. Propose the change with docket_propose_ontology_change instead.`)
  if (caught instanceof StaleDraft) return failed(`Nothing was published: ${caught.message}. Read the ontology again with docket_ontology and make the change against it.`)
  if (caught instanceof MigrationInvalid) return failed(`Nothing was published: the migration cannot apply. ${caught.message}`)
  if (caught instanceof OntologyBreakingChange) {
    const broken = caught.check.introduced.filter(isBreaking).slice(0, 20)
    return failed(
      [
        `Nothing was published: ${caught.message}.`,
        'Resolve each with a migration step (renameType, mapType, renameRelationship), or give it a disposition (accept-data-loss, or update-in-repo for a repo document a step covers):',
        ...broken.map((d) => `- ${d.id ?? d.path ?? ''}: ${d.message}`)
      ].join('\n')
    )
  }
  if (caught instanceof OntologyNarrowingChange) {
    return failed(
      [`Nothing was published: ${caught.message} (acceptNarrowing: true).`, ...caught.check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`)].join(
        '\n'
      )
    )
  }
  return null
}

/** A published version, as `docket_publish_ontology_change` reports it. */
export interface PublishedVersion {
  version: number
  previous: number
  classification: DraftCheck['classification']
  rewritten: { resourceId: string; path: string; revision?: number }[]
  migration: Migration[]
  dispositions: { resourceId: string; disposition: Disposition }[]
}

/** `docket_publish_ontology_change`'s answer. `history` is where the version is recorded, and `rollback` how it reads. */
export function publishAnswer(published: PublishedVersion, history: string, rollback: string): ToolResult {
  const lines = [
    `Published v${published.version}${published.previous ? ` (was v${published.previous})` : ''}: ${published.classification}.`,
    published.rewritten.length ? `The migration rewrote ${published.rewritten.length} document(s).` : 'No documents were rewritten.',
    ...(published.migration.length ? [`Migration: ${published.migration.map(describeMigration).join(', ')}.`] : []),
    rollback
  ]
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      schema: PUBLISH_SCHEMA,
      version: published.version,
      previous: published.previous,
      classification: published.classification,
      rewritten: published.rewritten.map(({ resourceId, path, revision }) => ({ resourceId, path, ...(revision !== undefined ? { revision } : {}) })),
      migration: published.migration,
      dispositions: published.dispositions,
      history
    }
  }
}
