import { z } from '../vendor/zod.js';
import { EVIDENCE_LOCATION_FIELDS } from './document.js';
/** Attribute value kinds supported in v0. Deliberately minimal. */
export const ATTRIBUTE_TYPES = [
    'string',
    'number',
    'boolean',
    'string[]',
    'number[]'
];
/** How a source type is grouped: a person, a system such as a codebase, or content such as a document. */
export const SOURCE_KINDS = ['identity', 'system', 'content'];
/**
 * Who may set a source attribute. A policy trusts what the directory, a
 * connection or the source registry says (`attested`); `reporter` attributes
 * are claimed by whoever files the observation, and only those claims count.
 */
export const ATTRIBUTE_SETTERS = ['directory', 'connection', 'registry', 'reporter'];
// --- Schemas ---------------------------------------------------------------
export const attributeDefinitionSchema = z.object({
    type: z.enum(ATTRIBUTE_TYPES),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    description: z.string().optional()
});
export const extractionGuidanceSchema = z.object({
    instructions: z.string().optional(),
    clues: z.array(z.string()).optional(),
    doNotConfuseWith: z.array(z.string()).optional()
});
const probability = z.number().min(0).max(1);
export const confidenceRulesSchema = z.record(z.string(), probability);
export const resourceTypeDefinitionSchema = z.object({
    description: z.string().optional(),
    icon: z
        .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a Lucide icon name in kebab-case, such as "server"')
        .optional(),
    attributes: z.record(z.string(), attributeDefinitionSchema).optional(),
    extraction: extractionGuidanceSchema.optional(),
    confidence: confidenceRulesSchema.optional()
});
const typeConstraintSchema = z.union([z.literal('*'), z.array(z.string())]);
export const relationshipDefinitionSchema = z.object({
    description: z.string().optional(),
    from: typeConstraintSchema,
    to: typeConstraintSchema,
    attributes: z.record(z.string(), attributeDefinitionSchema).optional(),
    confidence: confidenceRulesSchema.optional()
});
const locationFieldsSchema = z.array(z.enum(EVIDENCE_LOCATION_FIELDS));
export const evidenceSourceDefinitionSchema = z.object({
    description: z.string().optional(),
    confidence: probability,
    requires: locationFieldsSchema.optional(),
    requiresAny: locationFieldsSchema.optional()
});
export const evidenceSettingsSchema = z.object({
    sources: z.record(z.string(), evidenceSourceDefinitionSchema).optional(),
    unevidenced: probability.optional()
});
const name = z.string().min(1);
export const sourceAttributeDefinitionSchema = attributeDefinitionSchema.extend({
    setBy: z.enum(ATTRIBUTE_SETTERS)
});
export const locatorFieldDefinitionSchema = z.object({
    description: z.string().optional(),
    required: z.boolean().optional()
});
export const sourceTypeDefinitionSchema = z.object({
    description: z.string().optional(),
    kind: z.enum(SOURCE_KINDS).optional(),
    identifiedBy: z.array(name).optional(),
    attributes: z.record(z.string(), sourceAttributeDefinitionSchema).optional(),
    locator: z.record(z.string(), locatorFieldDefinitionSchema.nullable().transform((field) => field ?? {})).optional(),
    requiresAny: z.array(name).optional()
});
const conditionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const conditionOperatorsSchema = z.strictObject({
    not: conditionValueSchema.optional(),
    in: z.array(conditionValueSchema).optional(),
    has: conditionValueSchema.optional(),
    gt: z.number().optional(),
    lt: z.number().optional(),
    exists: z.boolean().optional(),
    matches: z.string().optional()
});
export const policyConditionSchema = z.union([conditionValueSchema, conditionOperatorsSchema]);
export const policyWhenSchema = z
    .object({ about: name.optional(), source: name })
    .catchall(policyConditionSchema);
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
});
export const trustSettingsSchema = z.object({
    unevidenced: probability.optional(),
    fallback: probability.optional(),
    cap: probability.optional(),
    accept: z.record(z.string(), probability).optional(),
    bands: z.object({ established: probability.optional(), probable: probability.optional() }).optional(),
    policies: z.array(trustPolicySchema).optional()
});
export const ontologySchema = z.object({
    version: z.number(),
    resourceTypes: z.record(z.string(), resourceTypeDefinitionSchema).default({}),
    relationships: z
        .record(z.string(), relationshipDefinitionSchema)
        .default({}),
    sources: z.record(z.string(), sourceTypeDefinitionSchema).optional(),
    trust: trustSettingsSchema.optional(),
    evidence: evidenceSettingsSchema.optional()
});
