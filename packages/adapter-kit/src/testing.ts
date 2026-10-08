import type { EntityInput, EntityRelationship } from '@docket/contracts'

/**
 * An entity input with every field filled, for adapter tests that only care
 * about a few. Unevidenced unless the overrides say otherwise: an adapter
 * projects the assessment it is handed, it never computes one.
 */
export const entityInput = (overrides: Partial<EntityInput> & { id: string }): EntityInput => {
  const path = overrides.path ?? `.docket/${overrides.id}.md`
  return {
    kind: 'entity',
    revision: `sha256:${overrides.id}`,
    scope: 'default',
    type: overrides.id.split('.')[0] ?? 'service',
    title: overrides.id,
    path,
    paths: [path],
    tags: [],
    attributes: {},
    links: [],
    content: '',
    mentions: [],
    evidence: [],
    index: { graph: true, fts: true, vector: true },
    confidence: 0.5,
    basis: 'unevidenced',
    evidenceCount: 0,
    sources: [],
    ...overrides
  }
}

/** A relationship as an entity input carries it, unevidenced unless the overrides say otherwise. */
export const entityLink = (
  overrides: Partial<EntityRelationship> & Pick<EntityRelationship, 'rel' | 'target'>
): EntityRelationship => ({
  evidence: [],
  confidence: 0.5,
  basis: 'unevidenced',
  evidenceCount: 0,
  sources: [],
  ...overrides
})
