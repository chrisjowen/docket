import {
  type AttributeDefinition,
  type AttributeType,
  type Diagnostic,
  type MemoryDocument,
  type MemoryLink,
  type Ontology,
  type TypeConstraint,
  error,
  warning
} from '../model/index.js'

export interface ValidateOptions {
  /** Promote dangling-reference warnings to errors (spec §17, §40). */
  strict?: boolean
}

/** One predicate per attribute kind. Array kinds check every element. */
const MATCHES: Record<AttributeType, (value: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  'string[]': (v) => Array.isArray(v) && v.every((e) => typeof e === 'string'),
  'number[]': (v) => Array.isArray(v) && v.every((e) => typeof e === 'number')
}

/** Per spec §9 an `enum` constrains element values for the array kinds. */
const enumTargets = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value]

const constraintAllows = (
  constraint: TypeConstraint,
  type: string
): boolean => constraint === '*' || constraint.includes(type)

const describe = (constraint: TypeConstraint): string =>
  constraint === '*' ? '*' : constraint.join(', ')

/**
 * Shared by resource attributes and relationship attributes. `kind` is baked
 * into the diagnostic codes so the two sites stay distinguishable.
 */
const checkAttributes = (
  values: Record<string, unknown>,
  definitions: Record<string, AttributeDefinition>,
  kind: 'attribute' | 'link-attribute',
  subject: string,
  where: { path: string; id: string }
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []

  for (const [key, value] of Object.entries(values)) {
    const definition = definitions[key]

    if (!definition) {
      // Spec does not forbid extra attributes, so this stays a warning.
      diagnostics.push(
        warning(
          `unknown-${kind}`,
          `Attribute "${key}" is not declared on ${subject}.`,
          where
        )
      )
      continue
    }

    if (!MATCHES[definition.type](value)) {
      diagnostics.push(
        error(
          `${kind}-type-mismatch`,
          `Attribute "${key}" on ${subject} must be of type ${definition.type}.`,
          where
        )
      )
      continue
    }

    const allowed = definition.enum
    if (!allowed) continue

    for (const element of enumTargets(value)) {
      if (!allowed.includes(element as string | number)) {
        diagnostics.push(
          error(
            `${kind}-enum-violation`,
            `Attribute "${key}" on ${subject} has value ${JSON.stringify(element)}; allowed: ${allowed.join(', ')}.`,
            where
          )
        )
      }
    }
  }

  return diagnostics
}

const checkLink = (
  link: MemoryLink,
  document: MemoryDocument,
  ontology: Ontology,
  byId: Map<string, MemoryDocument>,
  strict: boolean
): Diagnostic[] => {
  const where = { path: document.path, id: document.id }
  const relationship = ontology.relationships[link.rel]

  if (!relationship) {
    return [
      error(
        'unknown-relationship',
        `Relationship "${link.rel}" is not registered in the ontology.`,
        where
      )
    ]
  }

  const diagnostics: Diagnostic[] = []

  if (!constraintAllows(relationship.from, document.type)) {
    diagnostics.push(
      error(
        'relationship-from-violation',
        `Relationship "${link.rel}" cannot originate from type "${document.type}"; allowed: ${describe(relationship.from)}.`,
        where
      )
    )
  }

  const target = byId.get(link.target)
  if (!target) {
    // Spec §17: the graph is built incrementally, so this is only fatal in
    // strict mode.
    const report = strict ? error : warning
    diagnostics.push(
      report(
        'dangling-reference',
        `Link "${link.rel}" targets "${link.target}", which does not exist.`,
        where
      )
    )
  } else if (!constraintAllows(relationship.to, target.type)) {
    diagnostics.push(
      error(
        'relationship-to-violation',
        `Relationship "${link.rel}" cannot target type "${target.type}" ("${link.target}"); allowed: ${describe(relationship.to)}.`,
        where
      )
    )
  }

  diagnostics.push(
    ...checkAttributes(
      link.attributes ?? {},
      relationship.attributes ?? {},
      'link-attribute',
      `relationship "${link.rel}"`,
      where
    )
  )

  return diagnostics
}

/**
 * Ontology-dependent validation of an entire document set. Structural
 * frontmatter checks and duplicate-id detection happen upstream in the parser
 * and scanner; this layer only answers questions the registry can answer.
 *
 * Diagnostics are returned, never thrown and never printed.
 */
export const validateDocuments = (
  documents: MemoryDocument[],
  ontology: Ontology,
  options: ValidateOptions = {}
): Diagnostic[] => {
  const strict = options.strict ?? false
  const byId = new Map(documents.map((d) => [d.id, d]))
  const diagnostics: Diagnostic[] = []

  for (const document of documents) {
    const where = { path: document.path, id: document.id }
    const resourceType = ontology.resourceTypes[document.type]

    if (!resourceType) {
      // Without a type definition there is nothing to check attributes
      // against, but links are relationship-scoped and still checkable.
      diagnostics.push(
        error(
          'unknown-type',
          `Resource type "${document.type}" is not registered in the ontology.`,
          where
        )
      )
    } else {
      diagnostics.push(
        ...checkAttributes(
          document.attributes,
          resourceType.attributes ?? {},
          'attribute',
          `type "${document.type}"`,
          where
        )
      )
    }

    for (const link of document.links) {
      diagnostics.push(...checkLink(link, document, ontology, byId, strict))
    }
  }

  return diagnostics
}
