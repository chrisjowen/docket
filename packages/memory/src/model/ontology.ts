import { z } from 'zod'

/** Attribute value kinds supported in v0. Deliberately minimal. */
export const ATTRIBUTE_TYPES = [
  'string',
  'number',
  'boolean',
  'string[]',
  'number[]'
] as const

export type AttributeType = (typeof ATTRIBUTE_TYPES)[number]

export interface AttributeDefinition {
  type: AttributeType
  /** Allowed values. Applies to the element type for array kinds. */
  enum?: (string | number)[]
  description?: string
}

/** Guidance for agents deciding when to capture this resource type. */
export interface ExtractionGuidance {
  instructions?: string
  clues?: string[]
  doNotConfuseWith?: string[]
}

export interface ResourceTypeDefinition {
  description?: string
  attributes?: Record<string, AttributeDefinition>
  extraction?: ExtractionGuidance
}

/** `"*"` means any registered resource type. */
export type TypeConstraint = '*' | string[]

export interface RelationshipDefinition {
  description?: string
  from: TypeConstraint
  to: TypeConstraint
  attributes?: Record<string, AttributeDefinition>
}

export interface Ontology {
  version: number
  resourceTypes: Record<string, ResourceTypeDefinition>
  relationships: Record<string, RelationshipDefinition>
}

// --- Schemas ---------------------------------------------------------------

export const attributeDefinitionSchema = z.object({
  type: z.enum(ATTRIBUTE_TYPES),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  description: z.string().optional()
})

export const extractionGuidanceSchema = z.object({
  instructions: z.string().optional(),
  clues: z.array(z.string()).optional(),
  doNotConfuseWith: z.array(z.string()).optional()
})

export const resourceTypeDefinitionSchema = z.object({
  description: z.string().optional(),
  attributes: z.record(z.string(), attributeDefinitionSchema).optional(),
  extraction: extractionGuidanceSchema.optional()
})

const typeConstraintSchema = z.union([z.literal('*'), z.array(z.string())])

export const relationshipDefinitionSchema = z.object({
  description: z.string().optional(),
  from: typeConstraintSchema,
  to: typeConstraintSchema,
  attributes: z.record(z.string(), attributeDefinitionSchema).optional()
})

export const ontologySchema = z.object({
  version: z.number(),
  resourceTypes: z.record(z.string(), resourceTypeDefinitionSchema).default({}),
  relationships: z
    .record(z.string(), relationshipDefinitionSchema)
    .default({})
})
