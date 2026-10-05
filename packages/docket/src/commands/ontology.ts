import { loadConfig } from '../config/loader.js'
import type {
  Diagnostic,
  Ontology,
  RelationshipDefinition,
  TypeConstraint
} from '../model/index.js'
import { loadOntology } from '../ontology/loader.js'

export interface OntologyOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
}

export interface OntologyResult {
  /** `null` when the registry is missing or invalid; see `diagnostics`. */
  ontology: Ontology | null
  diagnostics: Diagnostic[]
  /** Absolute path the registry was read from. */
  path: string
}

export interface NamedRelationship extends RelationshipDefinition {
  name: string
}

const admits = (constraint: TypeConstraint, type: string): boolean =>
  constraint === '*' || constraint.includes(type)

/** Read the repository's registry for inspection (spec §41). Never throws for content. */
export const ontology = async (
  options: OntologyOptions = {}
): Promise<OntologyResult> => {
  const resolved = await loadConfig(options.cwd ?? process.cwd())
  const loaded = await loadOntology(resolved)
  return { ...loaded, path: resolved.ontologyPath }
}

/** Relationships `type` may declare, for `docket ontology show <type>`. */
export const relationshipsFrom = (
  registry: Ontology,
  type: string
): NamedRelationship[] =>
  Object.entries(registry.relationships)
    .filter(([, definition]) => admits(definition.from, type))
    .map(([name, definition]) => ({ name, ...definition }))

/** Relationships that may point at `type`. */
export const relationshipsTo = (
  registry: Ontology,
  type: string
): NamedRelationship[] =>
  Object.entries(registry.relationships)
    .filter(([, definition]) => admits(definition.to, type))
    .map(([name, definition]) => ({ name, ...definition }))
