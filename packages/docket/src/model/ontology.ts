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
 * Legacy: how much one observation from each source kind is worth for this
 * resource type or relationship. The loader reads it as `trust.policies`
 * naming the type (`about`) and the source.
 *
 * @deprecated Write `trust.policies` instead.
 */
export type ConfidenceRules = Record<string, number>

export interface ResourceTypeDefinition {
  description?: string
  /** A Lucide icon name, such as `server`, that `docket open` draws the type with. */
  icon?: string
  attributes?: Record<string, AttributeDefinition>
  extraction?: ExtractionGuidance
  /** @deprecated Legacy per-type confidence; the loader converts it to `trust.policies`. */
  confidence?: ConfidenceRules
}

/** `"*"` means any registered resource type. */
export type TypeConstraint = '*' | string[]

export interface RelationshipDefinition {
  description?: string
  from: TypeConstraint
  to: TypeConstraint
  attributes?: Record<string, AttributeDefinition>
  /** @deprecated Legacy per-relationship confidence; the loader converts it to `trust.policies`. */
  confidence?: ConfidenceRules
}

/**
 * Legacy: a kind of place evidence comes from and what it is worth. The loader
 * reads each one as a source type and a base policy.
 *
 * @deprecated Write `sources:` and `trust.policies` instead.
 */
export interface EvidenceSourceDefinition {
  description?: string
  /** What one observation of this kind is worth when no type or relationship rule says otherwise. */
  confidence: number
  /** Location fields every observation of this kind must give. */
  requires?: EvidenceLocationField[]
  /** Location fields of which every observation must give at least one. */
  requiresAny?: EvidenceLocationField[]
}

/** @deprecated Write `sources:` and `trust:` instead; the loader converts this block. */
export interface EvidenceSettings {
  /** Replaces docket's built-in source kinds when present. */
  sources?: Record<string, EvidenceSourceDefinition>
  /** Confidence of a memory with no evidence and no stated `provenance.confidence`. */
  unevidenced?: number
}

/** How a source type is grouped: a person, a system such as a codebase, or content such as a document. */
export const SOURCE_KINDS = ['identity', 'system', 'content'] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]

/**
 * Who may set a source attribute. A policy trusts what the directory, a
 * connection or the source registry says (`attested`); `reporter` attributes
 * are claimed by whoever files the observation, and only those claims count.
 */
export const ATTRIBUTE_SETTERS = ['directory', 'connection', 'registry', 'reporter'] as const

export type AttributeSetter = (typeof ATTRIBUTE_SETTERS)[number]

/** An attribute of a source - a person's `role`, a document's `status` - that policies can test. */
export interface SourceAttributeDefinition extends AttributeDefinition {
  setBy: AttributeSetter
}

/** A field an observation of a source uses to point at what was seen: a repository, a URL, a message id. */
export interface LocatorFieldDefinition {
  description?: string
  /** Every observation of the source must give it. */
  required?: boolean
}

/**
 * A kind of source evidence comes from - a person, a codebase, GitHub, a
 * document - with the attributes policies can score it by and the fields its
 * observations point with. Nothing about a source is built in.
 */
export interface SourceTypeDefinition {
  description?: string
  kind?: SourceKind
  /**
   * The locator fields that identify one instance of the source - this
   * repository, that person - so its observations count once together.
   * Without them, every observation of the source is one instance.
   */
  identifiedBy?: string[]
  attributes?: Record<string, SourceAttributeDefinition>
  /** The fields an observation points with, beyond the legacy ones every source accepts. */
  locator?: Record<string, LocatorFieldDefinition>
  /** Locator fields of which every observation must give at least one. */
  requiresAny?: string[]
}

/** A value a policy condition compares with. */
export type ConditionValue = string | number | boolean

/** A condition on one attribute or locator field; every operator given must hold. */
export interface ConditionOperators {
  not?: ConditionValue
  in?: ConditionValue[]
  has?: ConditionValue
  gt?: number
  lt?: number
  exists?: boolean
  /** A glob such as `**\/*_test.*`, for locator fields. */
  matches?: string
}

/** A bare value means equals, or contains for a list attribute. */
export type PolicyCondition = ConditionValue | ConditionOperators

/**
 * When a policy applies: to observations from `source`, optionally only about
 * one resource type or relationship (`about`), and only when every other key
 * holds - an attribute of the source, or a locator field written `@field`.
 */
export interface PolicyWhen {
  about?: string
  source: string
  [condition: string]: PolicyCondition | undefined
}

/**
 * One confidence rule. A `score` policy prices an observation: the most
 * specific one that matches wins, ties going to the lower score. An `adjust`
 * policy moves the price by its amount; every matching one applies.
 */
export interface TrustPolicy {
  name: string
  description?: string
  when: PolicyWhen
  score?: number
  adjust?: number
}

/** Where a confidence counts as established or probable; below probable it is unverified. */
export interface ConfidenceBands {
  established: number
  probable: number
}

/** How confidence is computed from evidence, in one place. */
export interface TrustSettings {
  /** Confidence of a resource with no evidence and no stated `provenance.confidence`. */
  unevidenced?: number
  /** What an observation no `score` policy matches is worth. */
  fallback?: number
  /** No confidence goes above this: nothing is certain. */
  cap?: number
  /**
   * The score a supersede proposal needs to become fact, by the type of the
   * record it replaces; `default` for every other type.
   */
  accept?: Record<string, number>
  bands?: Partial<ConfidenceBands>
  policies?: TrustPolicy[]
}

export interface Ontology {
  version: number
  resourceTypes: Record<string, ResourceTypeDefinition>
  relationships: Record<string, RelationshipDefinition>
  /** The kinds of source evidence comes from. */
  sources?: Record<string, SourceTypeDefinition>
  /** The confidence policies and thresholds. */
  trust?: TrustSettings
  /** @deprecated Legacy evidence settings; the loader converts them to `sources:` and `trust:`. */
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

const name = z.string().min(1)

export const sourceAttributeDefinitionSchema = attributeDefinitionSchema.extend({
  setBy: z.enum(ATTRIBUTE_SETTERS)
})

export const locatorFieldDefinitionSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional()
})

export const sourceTypeDefinitionSchema = z.object({
  description: z.string().optional(),
  kind: z.enum(SOURCE_KINDS).optional(),
  identifiedBy: z.array(name).optional(),
  attributes: z.record(z.string(), sourceAttributeDefinitionSchema).optional(),
  locator: z.record(z.string(), locatorFieldDefinitionSchema.nullable().transform((field) => field ?? {})).optional(),
  requiresAny: z.array(name).optional()
})

const conditionValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const conditionOperatorsSchema = z.strictObject({
  not: conditionValueSchema.optional(),
  in: z.array(conditionValueSchema).optional(),
  has: conditionValueSchema.optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  exists: z.boolean().optional(),
  matches: z.string().optional()
})

export const policyConditionSchema = z.union([conditionValueSchema, conditionOperatorsSchema])

export const policyWhenSchema = z
  .object({ about: name.optional(), source: name })
  .catchall(policyConditionSchema)

export const trustPolicySchema = z
  .object({
    name,
    description: z.string().optional(),
    when: policyWhenSchema,
    score: probability.optional(),
    adjust: z.number().min(-1).max(1).optional()
  })
  .refine((policy) => (policy.score === undefined) !== (policy.adjust === undefined), {
    message: 'a policy gives either score or adjust'
  })

export const trustSettingsSchema = z.object({
  unevidenced: probability.optional(),
  fallback: probability.optional(),
  cap: probability.optional(),
  accept: z.record(z.string(), probability).optional(),
  bands: z.object({ established: probability.optional(), probable: probability.optional() }).optional(),
  policies: z.array(trustPolicySchema).optional()
})

export const ontologySchema = z.object({
  version: z.number(),
  resourceTypes: z.record(z.string(), resourceTypeDefinitionSchema).default({}),
  relationships: z
    .record(z.string(), relationshipDefinitionSchema)
    .default({}),
  sources: z.record(z.string(), sourceTypeDefinitionSchema).optional(),
  trust: trustSettingsSchema.optional(),
  evidence: evidenceSettingsSchema.optional()
})
