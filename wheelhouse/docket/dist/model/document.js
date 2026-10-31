import { z } from '../vendor/zod.js';
/**
 * Where a piece of evidence points. A source kind's ontology entry says which
 * of these it needs (`requires` / `requiresAny`), so `code` evidence names a
 * file while `api` evidence names an endpoint.
 */
export const EVIDENCE_LOCATION_FIELDS = [
    'repository',
    'path',
    'lines',
    'symbol',
    'key',
    'method',
    'endpoint',
    'urls',
    'commit'
];
export const DEFAULT_INDEX_FLAGS = {
    graph: true,
    fts: true,
    vector: true
};
// --- Structural (ontology-independent) validation -------------------------
const LINE_RANGE = /^(\d+)(?:-(\d+))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** `12` and `12-40`; a range must not run backwards. */
const linesSchema = z
    .union([z.number().int().positive(), z.string()])
    .transform(String)
    .refine((value) => {
    const match = LINE_RANGE.exec(value);
    if (!match)
        return false;
    const start = Number(match[1]);
    return start > 0 && (match[2] === undefined || Number(match[2]) >= start);
}, 'lines must be a line number or a range like 12-40');
/**
 * Frontmatter is YAML 1.2, so an unquoted `2026-10-05` arrives as the string it
 * was written as. A `Date` - from a caller that parsed YAML 1.1 - is written
 * back as the date alone when it has no time of day.
 */
const observedAtSchema = z
    .union([z.string(), z.date()])
    .transform((value) => {
    if (typeof value === 'string')
        return value;
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
})
    .refine((value) => ISO_DATE.test(value), 'observedAt must be a date (YYYY-MM-DD) or ISO timestamp');
/** A single URL is accepted for convenience and read as a list of one. */
const urlsSchema = z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .pipe(z.array(z.string().url()));
const text = z.string().min(1);
/**
 * Unknown keys are kept here so the parser can name them in a warning; they
 * never reach the normalized model.
 */
export const memoryEvidenceSchema = z
    .object({
    source: text,
    repository: text.optional(),
    path: text.optional(),
    lines: linesSchema.optional(),
    symbol: text.optional(),
    key: text.optional(),
    method: text.optional(),
    endpoint: text.optional(),
    urls: urlsSchema.optional(),
    commit: text.optional(),
    observedAt: observedAtSchema.optional(),
    observedBy: text.optional(),
    session: text.optional(),
    note: text.optional()
})
    .catchall(z.unknown());
export const MEMORY_EVIDENCE_FIELDS = Object.keys(memoryEvidenceSchema.shape);
export const memoryLinkSchema = z.object({
    rel: z.string().min(1),
    target: z.string().min(1),
    attributes: z.record(z.string(), z.unknown()).optional(),
    evidence: z.array(memoryEvidenceSchema).optional()
});
export const memoryProvenanceSchema = z.object({
    authority: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    capturedBy: z.string().optional()
});
export const memoryIndexFlagsSchema = z.object({
    graph: z.boolean().default(true),
    fts: z.boolean().default(true),
    vector: z.boolean().default(true)
});
/** Shape of the YAML frontmatter block. `id`, `type`, `title` are required. */
export const frontmatterSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    tags: z.array(z.string()).default([]),
    attributes: z.record(z.string(), z.unknown()).default({}),
    links: z.array(memoryLinkSchema).default([]),
    evidence: z.array(memoryEvidenceSchema).default([]),
    provenance: memoryProvenanceSchema.optional(),
    index: memoryIndexFlagsSchema.default(DEFAULT_INDEX_FLAGS)
});
