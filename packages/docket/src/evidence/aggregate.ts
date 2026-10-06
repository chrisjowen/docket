import {
  type Diagnostic,
  type EntityLink,
  type MemoryDocument,
  type MemoryEntity,
  type MemoryEvidence,
  error,
  warning
} from '../model/index.js'
import { stableStringify } from '../model/stable-json.js'
import { hashContent } from '../source/hashing.js'
import { assess, type ConfidenceModel } from './confidence.js'

export interface AggregateResult {
  /** One per id, in the path order of each id's first file. */
  entities: MemoryEntity[]
  /** Disagreements between files that describe the same id. */
  diagnostics: Diagnostic[]
}

const byPath = (a: MemoryDocument, b: MemoryDocument): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b)

/** First occurrence wins, so evidence keeps the order it was recorded in. */
const distinct = <T>(items: readonly T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = stableStringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const maxOf = (values: readonly (number | undefined)[]): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined)
  return defined.length === 0 ? undefined : Math.max(...defined)
}

/**
 * Adds `incoming` attributes to `merged` without overwriting: a key already
 * set keeps its value, and a different value is reported rather than applied.
 */
const mergeAttributes = (
  merged: Record<string, unknown>,
  incoming: Record<string, unknown>,
  report: (key: string, kept: unknown, ignored: unknown) => void
): void => {
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged)) merged[key] = value
    else if (!same(merged[key], value)) report(key, merged[key], value)
  }
}

interface LinkAccumulator {
  rel: string
  target: string
  attributes: Record<string, unknown>
  hasAttributes: boolean
  evidence: MemoryEvidence[]
  stated: (number | undefined)[]
}

/** Several bodies are kept in path order; an identical body is kept once. */
const mergeContent = (members: readonly MemoryDocument[]): string => {
  const [only] = members
  if (members.length === 1 && only) return only.content
  const bodies = distinct(members.map((member) => member.content.trim()).filter((body) => body.length > 0))
  return bodies.length === 0 ? '' : `${bodies.join('\n\n')}\n`
}

/**
 * Merges the files that declare one id. The first file by path is primary: it
 * names the type and title, and its attribute values stand when a later file
 * disagrees. Nothing a file records is dropped - tags, links, mentions and
 * evidence are unioned - except a file of a different type, which describes
 * something else and is left out with an error.
 */
const mergeGroup = (
  group: readonly MemoryDocument[],
  model: ConfidenceModel,
  diagnostics: Diagnostic[]
): MemoryEntity | undefined => {
  const [primary] = group
  if (!primary) return undefined

  const members: MemoryDocument[] = []
  for (const document of group) {
    if (document.type !== primary.type) {
      diagnostics.push(
        error(
          'conflicting-type',
          `"${document.id}" is a ${primary.type} in ${primary.path}, but this file says ${document.type}; it is left out until they agree.`,
          { path: document.path, id: document.id }
        )
      )
      continue
    }
    members.push(document)
  }

  const attributes: Record<string, unknown> = {}
  const links = new Map<string, LinkAccumulator>()

  for (const member of members) {
    const where = { path: member.path, id: member.id }
    mergeAttributes(attributes, member.attributes, (key, kept, ignored) =>
      diagnostics.push(
        warning(
          'conflicting-attribute',
          `Attribute "${key}" is ${JSON.stringify(kept)} in ${primary.path}; this file's ${JSON.stringify(ignored)} is not applied.`,
          where
        )
      )
    )

    for (const link of member.links) {
      const key = `${link.rel}\u0000${link.target}`
      let merged = links.get(key)
      if (!merged) {
        merged = { rel: link.rel, target: link.target, attributes: {}, hasAttributes: false, evidence: [], stated: [] }
        links.set(key, merged)
      }
      if (link.attributes) {
        merged.hasAttributes = true
        mergeAttributes(merged.attributes, link.attributes, (attribute, kept, ignored) =>
          diagnostics.push(
            warning(
              'conflicting-attribute',
              `Attribute "${attribute}" of ${link.rel} → ${link.target} is ${JSON.stringify(kept)} elsewhere; ${JSON.stringify(ignored)} here is not applied.`,
              where
            )
          )
        )
      }
      // Only what was seen of the link itself counts: that a resource was seen
      // somewhere says little about who owns it or what it depends on.
      merged.evidence.push(...(link.evidence ?? []))
      merged.stated.push(member.provenance?.confidence)
    }
  }

  const evidence = distinct(members.flatMap((member) => member.evidence))
  const stated = maxOf(members.map((member) => member.provenance?.confidence))

  const entityLinks: EntityLink[] = [...links.values()].map((link) => {
    const linkEvidence = distinct(link.evidence)
    return {
      rel: link.rel,
      target: link.target,
      ...(link.hasAttributes ? { attributes: link.attributes } : {}),
      evidence: linkEvidence,
      ...assess(model, { kind: 'relationship', rel: link.rel }, linkEvidence, maxOf(link.stated))
    }
  })

  const entity: Omit<MemoryEntity, 'hash'> = {
    id: primary.id,
    type: primary.type,
    title: primary.title,
    path: primary.path,
    paths: members.map((member) => member.path),
    tags: distinct(members.flatMap((member) => member.tags)),
    attributes,
    links: entityLinks,
    content: mergeContent(members),
    mentions: distinct(members.flatMap((member) => member.mentions)),
    evidence,
    ...(primary.provenance ? { provenance: primary.provenance } : {}),
    index: {
      graph: members.every((member) => member.index.graph),
      fts: members.every((member) => member.index.fts),
      vector: members.every((member) => member.index.vector)
    },
    ...assess(model, { kind: 'resource', type: primary.type }, evidence, stated)
  }

  return { ...entity, hash: hashContent(stableStringify(entity)) }
}

/**
 * Merges documents into entities, one per id. Every file that declares an id
 * is an observation of the same resource: its evidence is kept alongside the
 * others', never in place of them, and confidence is computed over all of it.
 *
 * Pass only documents that validated - a broken file has nothing reliable to
 * add. Pure and deterministic: the same documents always give the same
 * entities, hashes included.
 */
export const aggregate = (
  documents: readonly MemoryDocument[],
  model: ConfidenceModel
): AggregateResult => {
  const groups = new Map<string, MemoryDocument[]>()
  for (const document of [...documents].sort(byPath)) {
    const group = groups.get(document.id)
    if (group) group.push(document)
    else groups.set(document.id, [document])
  }

  const diagnostics: Diagnostic[] = []
  const entities: MemoryEntity[] = []
  for (const group of groups.values()) {
    const entity = mergeGroup(group, model, diagnostics)
    if (entity) entities.push(entity)
  }
  return { entities, diagnostics }
}
