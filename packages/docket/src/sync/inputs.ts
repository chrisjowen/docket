import { createHash } from 'node:crypto'

import type {
  CanonicalInput,
  DocumentInput,
  EvidenceRecord,
  ObservationInput,
  ObservedRelationship,
  SourceLocation
} from '@docket/contracts'
import { stableStringify } from '@docket/adapter-kit'

import { toEntityInput } from '../adapters/compat.js'
import type { MemoryDocument, MemoryEntity, MemoryEvidence } from '../model/index.js'
import { hashContent } from '../source/hashing.js'

/**
 * One canonical input and the entity it derives from. Every input belongs to
 * exactly one entity - an entity owns itself, the observations its files
 * record and the bodies of those files - so whatever holds or removes an
 * entity holds or removes everything derived from it.
 */
export interface DerivedInput {
  input: CanonicalInput
  owner: string
}

/** Every canonical input the files currently give, and the files behind each entity. */
export interface CanonicalState {
  /** Entity id to every file that declares it, in path order. */
  owners: ReadonlyMap<string, readonly string[]>
  /** Entities in path order, each followed by its observations and then its documents. */
  inputs: readonly DerivedInput[]
}

/** What an observation is of: a resource, or one relationship of it. */
type Subject = { entity: string } | { relationship: ObservedRelationship }

/**
 * An observation's id: its entity, then a hash of what it observed and the
 * whole evidence record. Evidence is append-only, so a record's content is
 * its identity - the same record in two files of one entity is one
 * observation, and a corrected record is a new observation replacing the old.
 */
const observationId = (owner: string, subject: Subject, evidence: MemoryEvidence): string => {
  const digest = createHash('sha256').update(stableStringify({ subject, evidence })).digest('hex')
  return `${owner}#${digest.slice(0, 16)}`
}

/** `12` or `12-40` as a span; anything else names no lines. */
const lineSpan = (lines: string | undefined): Pick<SourceLocation, 'startLine' | 'endLine'> => {
  const match = /^(\d+)(?:-(\d+))?$/.exec(lines ?? '')
  if (!match) return {}
  const startLine = Number(match[1])
  return { startLine, endLine: match[2] === undefined ? startLine : Number(match[2]) }
}

/** Where an observation points, as words: `services/orders/main.ts:12-40 OrdersRepository at 3f2c1d0`. */
const describeLocation = (evidence: MemoryEvidence): string =>
  [
    evidence.repository,
    evidence.path === undefined ? undefined : evidence.lines ? `${evidence.path}:${evidence.lines}` : evidence.path,
    evidence.symbol,
    evidence.key === undefined ? undefined : `key ${evidence.key}`,
    evidence.endpoint === undefined ? undefined : [evidence.method, evidence.endpoint].filter(Boolean).join(' '),
    evidence.commit === undefined ? undefined : `at ${evidence.commit}`,
    ...(evidence.urls ?? [])
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' ')

/** What was seen, where: `service.orders (Orders) seen in code at src/db.ts:12: opens the pool`. */
const observationText = (entity: MemoryEntity, subject: Subject, evidence: MemoryEvidence): string => {
  const what =
    'entity' in subject
      ? `${entity.id} (${entity.title})`
      : `${subject.relationship.source} ${subject.relationship.rel} ${subject.relationship.target}`
  const where = describeLocation(evidence)
  return `${what} seen in ${evidence.source}${where ? ` at ${where}` : ''}${evidence.note ? `: ${evidence.note}` : ''}`
}

/** An input's revision when no file hash names it: a hash of everything it carries. */
const revisionOf = (input: Omit<CanonicalInput, 'revision'>): string => hashContent(stableStringify(input))

interface PendingObservation {
  subject: Subject
  evidence: MemoryEvidence
  recordedIn: string[]
}

/**
 * The observations an entity's files record, one per distinct evidence record
 * of the resource or of one of its relationships, in the order first
 * recorded. Only what the record states is carried: `observedAt` when it
 * gives one, and never an event time, which canonical evidence does not
 * record - a file's modification time is not when anything happened.
 */
const observationsOf = (entity: MemoryEntity, members: readonly MemoryDocument[], scope: string): ObservationInput[] => {
  const pending = new Map<string, PendingObservation>()
  const record = (subject: Subject, evidence: MemoryEvidence, path: string): void => {
    const id = observationId(entity.id, subject, evidence)
    const known = pending.get(id)
    if (known === undefined) pending.set(id, { subject, evidence, recordedIn: [path] })
    else if (!known.recordedIn.includes(path)) known.recordedIn.push(path)
  }
  for (const member of members) {
    for (const evidence of member.evidence) record({ entity: entity.id }, evidence, member.path)
    for (const link of member.links) {
      const relationship = { source: entity.id, rel: link.rel, target: link.target }
      for (const evidence of link.evidence ?? []) record({ relationship }, evidence, member.path)
    }
  }

  return [...pending.entries()].map(([id, { subject, evidence, recordedIn }]) => {
    const location: SourceLocation[] =
      evidence.path === undefined ? [] : [{ path: evidence.path, ...lineSpan(evidence.lines) }]
    const observation: Omit<ObservationInput, 'revision'> = {
      kind: 'observation',
      id,
      scope,
      text: observationText(entity, subject, evidence),
      sources: location,
      entityRefs: 'entity' in subject ? [entity.id] : [entity.id, subject.relationship.target],
      ...(evidence.observedAt !== undefined ? { observedAt: evidence.observedAt } : {}),
      recordedIn,
      evidence: { ...evidence } as EvidenceRecord,
      ...('relationship' in subject ? { relationship: subject.relationship } : {})
    }
    return { ...observation, revision: revisionOf(observation) }
  })
}

/**
 * A file's Markdown body as a document: its text is exactly lines
 * `startLine`-`endLine` of the file at `revision` (the file's hash), leading
 * blank lines and trailing whitespace left out. Its id is the file's path; a
 * file without a body gives none.
 */
const documentOf = (entity: MemoryEntity, member: MemoryDocument, scope: string): DocumentInput | undefined => {
  const lines = member.content.split('\n')
  let first = 0
  while (first < lines.length && (lines[first] ?? '').trim() === '') first += 1
  const text = lines.slice(first).join('\n').trimEnd()
  if (text.length === 0) return undefined

  const startLine = member.bodyLine + first
  return {
    kind: 'document',
    id: member.path,
    revision: member.hash,
    scope,
    text,
    source: { path: member.path, startLine, endLine: startLine + text.split('\n').length - 1 },
    entityRefs: [entity.id, ...member.mentions.filter((mention) => mention !== entity.id)]
  }
}

/**
 * Every canonical input the entities and their files give, in `scope`.
 * Entities keep the identity and revision they always had: their id, and
 * their merged hash. `documents` may hold more than the entities' files;
 * only the files an entity merged are read.
 */
export const canonicalState = (
  entities: readonly MemoryEntity[],
  documents: readonly MemoryDocument[],
  scope: string
): CanonicalState => {
  const byPath = new Map(documents.map((document) => [document.path, document]))
  const owners = new Map<string, readonly string[]>()
  const inputs: DerivedInput[] = []

  for (const entity of entities) {
    owners.set(entity.id, entity.paths)
    const members = entity.paths.flatMap((path) => {
      const member = byPath.get(path)
      return member === undefined ? [] : [member]
    })
    const derived: CanonicalInput[] = [
      toEntityInput(entity, scope),
      ...observationsOf(entity, members, scope),
      ...members.flatMap((member) => documentOf(entity, member, scope) ?? [])
    ]
    for (const input of derived) inputs.push({ input, owner: entity.id })
  }

  return { owners, inputs }
}
