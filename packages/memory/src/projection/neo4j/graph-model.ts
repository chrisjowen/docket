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
