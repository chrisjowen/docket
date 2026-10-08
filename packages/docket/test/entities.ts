import { aggregate } from '../src/evidence/aggregate.js'
import { confidenceModel } from '../src/evidence/confidence.js'
import {
  DEFAULT_INDEX_FLAGS,
  type MemoryDocument,
  type MemoryEntity,
  type Ontology
} from '../src/model/index.js'

/** No types of its own, so confidence comes from the built-in source kinds alone. */
const BARE: Ontology = { version: 1, resourceTypes: {}, relationships: {} }

/** A parsed document with every field filled, for tests that only care about a few. */
export const makeDocument = (
  overrides: Partial<MemoryDocument> & { id: string }
): MemoryDocument => ({
  type: overrides.id.split('.')[0] ?? 'service',
  title: overrides.id,
  path: `.docket/${overrides.id}.md`,
  hash: `sha256:${overrides.id}`,
  tags: [],
  attributes: {},
  links: [],
  content: '',
  bodyLine: 1,
  mentions: [],
  evidence: [],
  index: DEFAULT_INDEX_FLAGS,
  ...overrides
})

/** Documents as projections receive them: merged per id, confidence computed. */
export const entitiesOf = (
  documents: readonly MemoryDocument[],
  ontology: Ontology = BARE
): MemoryEntity[] => aggregate(documents, confidenceModel(ontology)).entities

/** One document as the entity projections receive. */
export const entityOf = (document: MemoryDocument, ontology: Ontology = BARE): MemoryEntity => {
  const [entity] = entitiesOf([document], ontology)
  if (!entity) throw new Error(`no entity for ${document.id}`)
  return entity
}
