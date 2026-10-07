import { z } from 'zod'

import { EVIDENCE_LOCATION_FIELDS, type EvidenceLocationField } from './document.js'

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

/**
 * How much one observation from each source kind is worth for this resource
 * type or relationship, overriding the source's own `confidence` - e.g. a pod
 * read from code is worth less than one seen running.
 */
export type ConfidenceRules = Record<string, number>

export interface ResourceTypeDefinition {
  description?: string
  /** A Lucide icon name, such as `server`, that `docket open` draws the type with. */
  icon?: string
  attributes?: Record<string, AttributeDefinition>
  extraction?: ExtractionGuidance
  confidence?: ConfidenceRules
}

/** `"*"` means any registered resource type. */
export type TypeConstraint = '*' | string[]

export interface RelationshipDefinition {
  description?: string
  from: TypeConstraint
  to: TypeConstraint
  attributes?: Record<string, AttributeDefinition>
  confidence?: ConfidenceRules
}

/** A kind of place evidence comes from - `code`, `manifest`, `api` - and what it is worth. */
export interface EvidenceSourceDefinition {
  description?: string
  /** What one observation of this kind is worth when no type or relationship rule says otherwise. */
  confidence: number
  /** Location fields every observation of this kind must give. */
  requires?: EvidenceLocationField[]
  /** Location fields of which every observation must give at least one. */
  requiresAny?: EvidenceLocationField[]
}

export interface EvidenceSettings {
  /** Replaces docket's built-in source kinds when present. */
  sources?: Record<string, EvidenceSourceDefinition>
  /** Confidence of a memory with no evidence and no stated `provenance.confidence`. */
  unevidenced?: number
}

export interface Ontology {
  version: number
  resourceTypes: Record<string, ResourceTypeDefinition>
  relationships: Record<string, RelationshipDefinition>
  evidence?: EvidenceSettings
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

const probability = z.number().min(0).max(1)

export const confidenceRulesSchema = z.record(z.string(), probability)

export const resourceTypeDefinitionSchema = z.object({
  description: z.string().optional(),
  icon: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a Lucide icon name in kebab-case, such as "server"')
    .optional(),
  attributes: z.record(z.string(), attributeDefinitionSchema).optional(),
  extraction: extractionGuidanceSchema.optional(),
  confidence: confidenceRulesSchema.optional()
})

const typeConstraintSchema = z.union([z.literal('*'), z.array(z.string())])

export const relationshipDefinitionSchema = z.object({
  description: z.string().optional(),
  from: typeConstraintSchema,
  to: typeConstraintSchema,
  attributes: z.record(z.string(), attributeDefinitionSchema).optional(),
  confidence: confidenceRulesSchema.optional()
})

const locationFieldsSchema = z.array(z.enum(EVIDENCE_LOCATION_FIELDS))

export const evidenceSourceDefinitionSchema = z.object({
  description: z.string().optional(),
  confidence: probability,
  requires: locationFieldsSchema.optional(),
  requiresAny: locationFieldsSchema.optional()
})

export const evidenceSettingsSchema = z.object({
  sources: z.record(z.string(), evidenceSourceDefinitionSchema).optional(),
  unevidenced: probability.optional()
})

export const ontologySchema = z.object({
  version: z.number(),
  resourceTypes: z.record(z.string(), resourceTypeDefinitionSchema).default({}),
  relationships: z
    .record(z.string(), relationshipDefinitionSchema)
    .default({}),
  evidence: evidenceSettingsSchema.optional()
})
