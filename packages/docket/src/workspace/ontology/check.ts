import { aggregate } from '../../evidence/aggregate.js'
import { bandOf, confidenceModel } from '../../evidence/confidence.js'
import { parseMemoryFile, parseOntology, validateDocuments, type Diagnostic, type MemoryDocument, type Ontology } from '../docket.js'
import { writableHere, type Origin } from '../origin.js'
import { diffOntologies, type Change } from './diff.js'
import { MigrationInvalid, OntologyInvalid, isBreaking } from './errors.js'
import { describeMigration, migrationProblems, rewriteDocument, type Migration } from './migrations.js'
import { lintOntology, sizeProblem } from './yaml-io.js'

/** A resource or link whose confidence the draft changes. */
export interface Rescored {
  resourceId: string
  /** Set when it is one of the resource's links that is rescored. */
  link?: { rel: string; target: string }
  before: number
  after: number
  bandBefore: Band
  bandAfter: Band
}

type Band = ReturnType<typeof bandOf>

/**
 * `safe` changes nothing a document says or how far it is trusted; `rescore`
 * changes confidence - a policy, a source, a threshold - and nothing else;
 * `narrowing` gives documents new diagnostics; `breaking` leaves resources or
 * links the ontology no longer knows.
 */
export type Classification = 'safe' | 'rescore' | 'narrowing' | 'breaking'

/** Narrowing and breaking changes are published only when the publisher accepts them; a rescore is not. */
export const needsAcceptance = (classification: Classification): boolean =>
  classification === 'narrowing' || classification === 'breaking'

/** What a draft would do to the workspace's documents. */
export interface CheckResult {
  classification: Classification
  /** Diagnostics the draft gives that the head does not. */
  introduced: Diagnostic[]
  /** Diagnostics the head gives that the draft clears. */
  resolved: Diagnostic[]
  /** The resources that gain a diagnostic, and where each came from. */
  affected: { resourceId: string; origin: Origin }[]
  /** Every resource and link whose confidence changes, in id order. */
  rescored: Rescored[]
}

/** A check as the editor shows it: the result, and what it was made of. */
export interface DraftCheck extends CheckResult {
  /** The head the draft was checked against; 0 when nothing is published yet. */
  head: number
  /** How many documents were validated. */
  documents: number
  /** docket's loader warnings and the editor's lint for the draft itself. */
  ontology: Diagnostic[]
  /** The structural diff from the head. */
  changes: Change[]
  /** Cloud documents the migration would rewrite. */
  migrated: string[]
  /**
   * The resources a breaking change still leaves unknown once the migration
   * has run: each blocks publishing until the publisher gives it a
   * disposition.
   */
  unresolved: Unresolved[]
}

/**
 * What the publisher decides for a resource a breaking change leaves unknown:
 * `update-in-repo`, pending repo work for a repo or CLI document that a
 * migration step names the change of; or `accept-data-loss`.
 */
export type Disposition = 'update-in-repo' | 'accept-data-loss'

export const DISPOSITIONS: readonly Disposition[] = ['update-in-repo', 'accept-data-loss']

/** A resource a breaking change leaves unknown. */
export interface Unresolved {
  resourceId: string
  origin: Origin
  /** Its breaking changes, as `type pod` or `relationship runs_on`. */
  changes: string[]
  /** A repo or CLI document whose every change a migration step names: it can be updated at its source. */
  updatable: boolean
}

/** A disposition as published, recorded with the version. */
export interface Disposed extends Unresolved {
  disposition: Disposition
}

/**
 * Identifies a diagnostic across two ontologies: its code, file and resource,
 * and the rest of its message, which names the relationship and target or the
 * attribute. The list of what is allowed is left out, so a violation that was
 * already there is not reported again when only that list changed.
 */
export function diagnosticKey(diagnostic: Diagnostic): string {
  const subject = diagnostic.message.replace(/;\s*(allowed|known sources):.*$/s, '')
  return [diagnostic.code, diagnostic.path ?? '', diagnostic.id ?? '', subject].join('\u0000')
}

function multiset(diagnostics: readonly Diagnostic[]) {
  const counts = new Map<string, number>()
  for (const d of diagnostics) counts.set(diagnosticKey(d), (counts.get(diagnosticKey(d)) ?? 0) + 1)
  return counts
}

/** The diagnostics of `after` that `before` does not have, as many times as they are new. */
function minus(after: readonly Diagnostic[], before: readonly Diagnostic[]): Diagnostic[] {
  const remaining = multiset(before)
  return after.filter((d) => {
    const key = diagnosticKey(d)
    const left = remaining.get(key) ?? 0
    if (left > 0) {
      remaining.set(key, left - 1)
      return false
    }
    return true
  })
}

/** The breaking change a diagnostic reports, as `type pod` or `relationship runs_on`. */
export function breakingChange(diagnostic: Diagnostic): string {
  const name = /"([^"]*)"/.exec(diagnostic.message)?.[1] ?? ''
  return `${diagnostic.code === 'unknown-type' ? 'type' : 'relationship'} ${name}`
}

/** The breaking change a migration step resolves; null for one that resolves none. */
function resolvedBy(step: Migration): string | null {
  if (step.op === 'renameType' || step.op === 'mapType') return `type ${step.from}`
  if (step.op === 'renameRelationship') return `relationship ${step.from}`
  return null
}

export function classify(introduced: readonly Diagnostic[], rescored: readonly Rescored[] = []): Classification {
  if (introduced.some(isBreaking)) return 'breaking'
  if (introduced.length) return 'narrowing'
  return rescored.length ? 'rescore' : 'safe'
}

/**
 * The resources and links whose confidence differs between two ontologies.
 * Confidence is computed when read, so this is everything publishing the
 * draft re-scores; a resource or link that is only on one side is a
 * diagnostic's business, not this.
 */
export function rescore(
  before: { documents: readonly MemoryDocument[]; ontology: Ontology | null },
  after: { documents: readonly MemoryDocument[]; ontology: Ontology }
): Rescored[] {
  if (!before.ontology) return []
  const was = confidenceModel(before.ontology)
  const now = confidenceModel(after.ontology)
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
  return out.sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0))
}

/**
 * Validates documents against two ontologies with docket's validator and
 * diffs the diagnostics. `after` may hold other documents than `before`: a
 * migration's rewritten ones.
 */
export function compare(
  before: { documents: readonly MemoryDocument[]; ontology: Ontology | null },
  after: { documents: readonly MemoryDocument[]; ontology: Ontology },
  origins: ReadonlyMap<string, Origin>
): CheckResult {
  const was = before.ontology ? validateDocuments([...before.documents], before.ontology) : []
  const now = validateDocuments([...after.documents], after.ontology)
  const introduced = minus(now, was)
  const resolved = minus(was, now)
  const seen = new Set<string>()
  const affected: CheckResult['affected'] = []
  for (const d of introduced) {
    const resourceId = d.id ?? d.path ?? ''
    const origin = (d.path && origins.get(d.path)) || 'cloud'
    const key = `${resourceId}\u0000${origin}`
    if (seen.has(key)) continue
    seen.add(key)
    affected.push({ resourceId, origin })
  }
  affected.sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0))
  const rescored = rescore(before, after)
  return { classification: classify(introduced, rescored), introduced, resolved, affected, rescored }
}

/** Parses a draft, or throws `OntologyInvalid` with its errors at their paths. */
export function parseDraft(yaml: string): { ontology: Ontology; diagnostics: Diagnostic[] } {
  const tooLarge = sizeProblem(yaml)
  if (tooLarge) throw new OntologyInvalid([tooLarge])
  const loaded = parseOntology(yaml)
  if (!loaded.ontology) throw new OntologyInvalid(loaded.diagnostics)
  return { ontology: loaded.ontology, diagnostics: [...loaded.diagnostics, ...lintOntology(loaded.ontology)] }
}

/**
 * The workspace as a check sees it: its parsed documents, where each came
 * from by path, and its published head. A store reads it in the transaction
 * the check runs in.
 */
export interface WorkspaceSnapshot {
  documents: readonly MemoryDocument[]
  origins: ReadonlyMap<string, Origin>
  head: { number: number; ontology: Ontology | null } | null
}

/** A stored document as a migration reads it: its text, absent when it does not open. */
export interface StoredDocument {
  path: string
  origin: Origin
  raw?: string
}

/** A cloud document a migration rewrites, its new text, and the evidence entry the rewrite appends. */
export interface Rewrite {
  path: string
  raw: string
  resourceId: string
  evidence: Record<string, string>
}

/** What publishing a draft would do: the check, the migration's rewrites, and what it still leaves unknown. */
export interface Evaluation {
  check: CheckResult
  rewrites: Rewrite[]
  unresolved: Unresolved[]
  head: WorkspaceSnapshot['head']
  /** How many documents were validated. */
  documents: number
}

/**
 * Checks an ontology against the workspace as publishing it would: with the
 * migration's rewrites of cloud documents applied first. `stored` is the
 * workspace's documents with their text, which only a migration reads. Repo
 * and CLI documents are never rewritten here: every resource a breaking
 * change still leaves unknown is `unresolved`, and is `updatable` when it is
 * a repo or CLI document and a step names each of its changes. Throws
 * `MigrationInvalid` for a migration that names what the draft does not have.
 */
export function evaluateDraft(
  snapshot: WorkspaceSnapshot,
  stored: readonly StoredDocument[],
  draft: Ontology,
  options: { migration?: readonly Migration[]; version?: number; login?: string } = {}
): Evaluation {
  const headOntology = snapshot.head?.ontology ?? null
  const before = { documents: snapshot.documents, ontology: headOntology }
  const migration = options.migration ?? []
  const version = options.version ?? (snapshot.head?.number ?? 0) + 1
  const rewrites: Rewrite[] = []
  let after = snapshot.documents
  if (migration.length) {
    const problems = migrationProblems(migration, draft)
    if (problems.length) throw new MigrationInvalid(problems)
    const migrated = new Map<string, MemoryDocument>()
    for (const document of stored) {
      if (document.raw === undefined || !writableHere(document.origin)) continue
      const next = rewriteDocument(document.raw, migration, (applied) => ({
        source: 'human',
        observedBy: options.login ?? 'publisher',
        note: `ontology v${version} migration: ${applied.map(describeMigration).join(', ')}`
      }))
      const parsed = next && parseMemoryFile(next.raw, document.path).document
      if (!next || !parsed) continue
      migrated.set(document.path, parsed)
      rewrites.push({ path: document.path, raw: next.raw, resourceId: parsed.id, evidence: next.evidence })
    }
    after = snapshot.documents.map((document) => migrated.get(document.path) ?? document)
  }
  const check = compare(before, { documents: after, ontology: draft }, snapshot.origins)
  const named = new Set(migration.map(resolvedBy))
  const byResource = new Map<string, Unresolved>()
  for (const d of check.introduced) {
    if (!isBreaking(d)) continue
    const resourceId = d.id ?? d.path ?? ''
    const origin = (d.path && snapshot.origins.get(d.path)) || 'cloud'
    const entry = byResource.get(resourceId) ?? { resourceId, origin, changes: [], updatable: !writableHere(origin) }
    const change = breakingChange(d)
    if (!entry.changes.includes(change)) entry.changes.push(change)
    entry.updatable &&= named.has(change)
    byResource.set(resourceId, entry)
  }
  const unresolved = [...byResource.values()].sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0))
  return { check, rewrites, unresolved, head: snapshot.head, documents: snapshot.documents.length }
}

/**
 * Re-validates every document of the workspace against the draft and diffs
 * the diagnostics with the published head's, with the migration's rewrites
 * applied when there is one. Throws `OntologyInvalid` when the draft is not
 * an ontology, and `MigrationInvalid` for a migration that names what the
 * draft does not have.
 */
export function checkDraft(
  snapshot: WorkspaceSnapshot,
  stored: readonly StoredDocument[],
  draftYaml: string,
  options: { migration?: readonly Migration[]; login?: string } = {}
): DraftCheck {
  const draft = parseDraft(draftYaml)
  const result = evaluateDraft(snapshot, stored, draft.ontology, options)
  return {
    ...result.check,
    head: result.head?.number ?? 0,
    documents: result.documents,
    ontology: draft.diagnostics,
    changes: diffOntologies(result.head?.ontology ?? null, draft.ontology),
    migrated: result.rewrites.map((rewrite) => rewrite.path),
    unresolved: result.unresolved
  }
}
