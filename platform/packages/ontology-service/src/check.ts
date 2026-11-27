// SPDX-License-Identifier: AGPL-3.0-only
import {
  aggregate,
  bandOf,
  listDocuments,
  orgTrust,
  parseMemoryFile,
  parseOntology,
  postgresSource,
  publishedOntology,
  readCanonical,
  readDocuments,
  snapshotProposals,
  trustModel,
  type MemoryDocument,
  type Ontology,
  type OrgTrust,
  type StoreContext,
} from '@docket/platform-canonical-store'
import {
  classify,
  evaluateDraft,
  parseDraft,
  scoreProposal,
  type CheckResult,
  type DraftCheck,
  type Evaluation,
  type ProposalChange,
  type Rescored,
  type SnapshotProposal,
  type StoredDocument,
  type WorkspaceSnapshot,
} from '@chrisjowen/docket/workspace'

import { diffOntologies } from './diff.js'
import type { Migration } from './migrations.js'

/**
 * The change check (§13.5) is docket's: it re-validates every document of the
 * workspace against a draft, classifies the change - `safe`, `rescore` when
 * it moves confidence and nothing else, `narrowing`, `breaking` - and lists
 * every resource and link it rescores with its band before and after, and the
 * supersede proposals it would decide differently. The cloud reads the
 * workspace for it, and scores both sides with everything the org attests.
 */
export {
  DISPOSITIONS,
  breakingChange,
  classify,
  diagnosticKey,
  needsAcceptance,
  parseDraft,
  type CheckResult,
  type Classification,
  type Disposed,
  type Disposition,
  type DraftCheck,
  type ProposalChange,
  type Rescored,
  type Rewrite,
  type Unresolved,
} from '@chrisjowen/docket/workspace'

/** The workspace as a check sees it: its parsed documents, where each came from, its head, its people and its open proposals. */
export async function workspaceSnapshot(ctx: StoreContext, workspaceId: string): Promise<WorkspaceSnapshot & { trust: OrgTrust }> {
  // One query at a time: they share the transaction's connection.
  const read = await readCanonical(postgresSource(ctx, workspaceId))
  const records = await listDocuments(ctx.tx, workspaceId)
  const head = await publishedOntology(ctx, workspaceId)
  const headOntology = head ? parseOntology(head.text).ontology : null
  const trust = await orgTrust(ctx)
  const proposals = await snapshotProposals(ctx, workspaceId)
  return {
    documents: read.documents,
    origins: new Map(records.map((record) => [record.path, record.origin])),
    head: head ? { number: head.number, ontology: headOntology } : null,
    people: trust.people,
    proposals,
    trust,
  }
}

const byResource = <T extends { resourceId?: string; resource?: string }>(a: T, b: T) => {
  const x = a.resourceId ?? a.resource ?? ''
  const y = b.resourceId ?? b.resource ?? ''
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * The resources and links whose confidence differs between two ontologies,
 * scored with what the org attests: docket's `rescore`, with the cloud's
 * registry, so a policy on a document's status or a repository's settings
 * moves what it should.
 */
export function rescoreWith(
  trust: OrgTrust,
  before: { documents: readonly MemoryDocument[]; ontology: Ontology | null },
  after: { documents: readonly MemoryDocument[]; ontology: Ontology },
): Rescored[] {
  if (!before.ontology) return []
  const was = trustModel(before.ontology, trust)
  const now = trustModel(after.ontology, trust)
  const previous = new Map(aggregate(before.documents, was).entities.map((entity) => [entity.id, entity]))
  const out: Rescored[] = []
  const note = (resourceId: string, from: number, to: number, link?: Rescored['link']) => {
    if (from === to) return
    out.push({ resourceId, ...(link ? { link } : {}), before: from, after: to, bandBefore: bandOf(was, from), bandAfter: bandOf(now, to) })
  }
  for (const entity of aggregate(after.documents, now).entities) {
    const then = previous.get(entity.id)
    if (!then) continue
    note(entity.id, then.confidence, entity.confidence)
    for (const link of entity.links) {
      const old = then.links.find((candidate) => candidate.rel === link.rel && candidate.target === link.target)
      if (old) note(entity.id, old.confidence, link.confidence, { rel: link.rel, target: link.target })
    }
  }
  return out.sort(byResource)
}

/** The supersede proposals two ontologies decide differently, scored with what the org attests: docket's `proposalChanges`, with the cloud's registry. */
export function proposalChangesWith(
  trust: OrgTrust,
  proposals: readonly SnapshotProposal[],
  documents: readonly MemoryDocument[],
  before: Ontology | null,
  after: Ontology,
): ProposalChange[] {
  if (!before || proposals.length === 0) return []
  const was = trustModel(before, trust)
  const now = trustModel(after, trust)
  const types = new Map(documents.map((document) => [document.id, document.type]))
  const out: ProposalChange[] = []
  for (const proposal of proposals) {
    const type = types.get(proposal.resource)
    const then = scoreProposal(was, type, proposal.evidence)
    const next = scoreProposal(now, type, proposal.evidence)
    const change =
      proposal.status === 'pending' && !then.clears && next.clears
        ? 'would-accept'
        : proposal.status === 'accepted' && then.clears && !next.clears
          ? 'would-no-longer-pass'
          : null
    if (change) out.push({ proposal: proposal.id, resource: proposal.resource, status: proposal.status, before: then.score, after: next.score, threshold: next.threshold, change })
  }
  return out.sort(byResource)
}

/**
 * Checks an ontology against the workspace as publishing it would: with the
 * migration's rewrites of cloud documents applied first (§13.5). Repo and CLI
 * documents are never rewritten here: every resource a breaking change still
 * leaves unknown is `unresolved`, and is `updatable` when it is a repo or CLI
 * document and a step names each of its changes. Throws `MigrationInvalid`
 * for a migration that names what the draft does not have.
 */
export async function evaluate(
  ctx: StoreContext,
  workspaceId: string,
  draft: Ontology,
  options: { migration?: readonly Migration[]; version?: number; login?: string } = {},
): Promise<Evaluation> {
  const snapshot = await workspaceSnapshot(ctx, workspaceId)
  // Only a migration reads the stored text: it rewrites cloud documents.
  const stored: StoredDocument[] = options.migration?.length
    ? (await readDocuments(ctx, workspaceId)).map((document) => ({ path: document.path, origin: document.origin, ...(document.raw !== undefined ? { raw: document.raw } : {}) }))
    : []
  const evaluation = evaluateDraft({ ...snapshot, proposals: [] }, stored, draft, options)
  // docket scores with the people directory; the cloud's registry attests more.
  const migrated = new Map(evaluation.rewrites.map((rewrite) => [rewrite.path, rewrite.raw]))
  const after = snapshot.documents.map((document) => {
    const raw = migrated.get(document.path)
    return raw === undefined ? document : (parseMemoryFile(raw, document.path).document ?? document)
  })
  const headOntology = snapshot.head?.ontology ?? null
  const rescored = rescoreWith(snapshot.trust, { documents: snapshot.documents, ontology: headOntology }, { documents: after, ontology: draft })
  const proposals = proposalChangesWith(snapshot.trust, snapshot.proposals ?? [], snapshot.documents, headOntology, draft)
  const check: CheckResult = { ...evaluation.check, rescored, proposals, classification: classify(evaluation.check.introduced, rescored, proposals) }
  return { ...evaluation, check }
}

/**
 * Re-validates every document of the workspace against the draft and diffs
 * the diagnostics with the published head's (§13.5), with the migration's
 * rewrites applied when there is one, and re-scores both sides. Writes
 * nothing. Throws `OntologyInvalid` when the draft is not an ontology, and
 * `MigrationInvalid` for a migration that names what the draft does not have.
 */
export async function checkDraft(
  ctx: StoreContext,
  workspaceId: string,
  draftYaml: string,
  options: { migration?: readonly Migration[]; login?: string } = {},
): Promise<DraftCheck> {
  const draft = parseDraft(draftYaml)
  const result = await evaluate(ctx, workspaceId, draft.ontology, options)
  return {
    ...result.check,
    head: result.head?.number ?? 0,
    documents: result.documents,
    ontology: draft.diagnostics,
    changes: diffOntologies(result.head?.ontology ?? null, draft.ontology),
    migrated: result.rewrites.map((rewrite) => rewrite.path),
    unresolved: result.unresolved,
  }
}
