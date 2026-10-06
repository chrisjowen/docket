import type { Assessment, MemoryEntity } from '../../model/index.js'

/**
 * How the memory model is named in Neo4j. Cypher cannot take labels or
 * relationship types as parameters, so they are built here from a strict
 * alphabet and nowhere else is anything interpolated into a query.
 */

const words = (name: string): string[] =>
  name.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0)

/** `data-source` → `DataSource`. Every node also carries the shared `Memory` label. */
export const labelFor = (type: string): string => {
  const label = words(type)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join('')
  if (!/^[A-Za-z]/.test(label)) throw new Error(`Cannot make a Neo4j label from type "${type}"`)
  return label
}

/** `depends_on` → `DEPENDS_ON`, the Neo4j convention for relationship types. */
export const relationshipTypeFor = (rel: string): string => {
  const type = words(rel).join('_').toUpperCase()
  if (!/^[A-Z]/.test(type)) {
    throw new Error(`Cannot make a Neo4j relationship type from "${rel}"`)
  }
  return type
}

/** Neo4j properties hold primitives and arrays of them; anything else is kept as JSON. */
export const toProperty = (value: unknown): unknown =>
  value === null ||
  ['string', 'number', 'boolean'].includes(typeof value) ||
  (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item)))
    ? value
    : JSON.stringify(value)

/**
 * How far a node or relationship is corroborated, as properties a query can
 * filter on: `WHERE r.confidence < 0.5`, `WHERE 'runtime' IN n.sources`. The
 * evidence itself is JSON, for reading rather than matching.
 */
const assessmentProperties = (assessed: Assessment & { evidence: unknown[] }): Record<string, unknown> => ({
  confidence: assessed.confidence,
  confidenceBasis: assessed.basis,
  evidenceCount: assessed.evidenceCount,
  sources: assessed.sources,
  evidence: JSON.stringify(assessed.evidence)
})

/** Every property an entity writes on its node. Removed again when the node becomes a stub. */
export const nodeProperties = (entity: MemoryEntity): Record<string, unknown> => ({
  type: entity.type,
  title: entity.title,
  path: entity.path,
  paths: entity.paths,
  content: entity.content,
  // A string, because the full-text index only reads string properties.
  tags: entity.tags.join(' '),
  hash: entity.hash,
  attributes: JSON.stringify(entity.attributes),
  ...assessmentProperties(entity)
})

/** Names of the properties `nodeProperties` writes. */
export const NODE_PROPERTIES = [
  'type',
  'title',
  'path',
  'paths',
  'content',
  'tags',
  'hash',
  'attributes',
  'confidence',
  'confidenceBasis',
  'evidenceCount',
  'sources',
  'evidence'
] as const

/** One relationship to write: the entity has exactly one per (rel, target). */
export interface RelationshipRow {
  /** Neo4j relationship type, e.g. `DEPENDS_ON`. */
  type: string
  rel: string
  target: string
  properties: Record<string, unknown>
}

/**
 * The relationships an entity writes, one per (source, rel, target) however
 * many files declared it. The link's own attributes come first, so they can
 * never shadow `rel` or the confidence a query relies on.
 */
export const relationshipRows = (entity: MemoryEntity): RelationshipRow[] =>
  entity.links.map((link) => ({
    type: relationshipTypeFor(link.rel),
    rel: link.rel,
    target: link.target,
    properties: {
      ...Object.fromEntries(
        Object.entries(link.attributes ?? {}).map(([key, value]) => [key, toProperty(value)])
      ),
      rel: link.rel,
      ...assessmentProperties(link)
    }
  }))

const LUCENE_SPECIAL = /[+\-!(){}[\]^"~*?:\\/&|]/g

/**
 * A Lucene query for the full-text index that matches documents containing any
 * of the words, so a question in plain English still finds its terms.
 */
export const fulltextQuery = (text: string): string =>
  text
    .split(/\s+/)
    .map((word) => word.replace(/["()?]/g, '').replace(LUCENE_SPECIAL, (c) => `\\${c}`))
    .filter((word) => word.length > 0 && word !== '\\')
    .join(' OR ')

export interface Neighbour {
  direction: 'out' | 'in'
  rel: string
  id: string
}

/** A node's links, as a line a reader can scan: `depends_on → x; ← uses y`. */
export const describeNeighbours = (neighbours: readonly Neighbour[]): string =>
  neighbours
    .map((n) => (n.direction === 'out' ? `${n.rel} → ${n.id}` : `← ${n.rel} ${n.id}`))
    .join('; ')
