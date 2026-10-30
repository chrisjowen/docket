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
export const ontologySchema = z.object({
    version: z.number(),
    resourceTypes: z.record(z.string(), resourceTypeDefinitionSchema).default({}),
    relationships: z
        .record(z.string(), relationshipDefinitionSchema)
        .default({}),
    evidence: evidenceSettingsSchema.optional()
});
