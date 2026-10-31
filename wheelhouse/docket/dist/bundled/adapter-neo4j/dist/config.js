import { ollamaModelSchema } from '../../adapter-kit/dist/index.js';
import { z } from '../../../vendor/zod.js';
/** The furthest a search expands from a match: past three hops, most graphs reach everything. */
export const MAX_HOPS = 3;
/**
 * A Neo4j graph of the documents and their links. The password is read from the
 * environment, never from the file; with `passwordEnv` unset the driver
 * connects without auth, as a local `NEO4J_AUTH=none` server expects.
 *
 * The connection URI is `uri`, the driver's own name for it, or `url`, its
 * name in v1 `projections` entries; either takes any scheme the driver does
 * (`bolt`, `neo4j`, `neo4j+s`, ...).
 */
export const neo4jConfigSchema = z.preprocess((value, context) => {
    if (value === null || typeof value !== 'object' || !('uri' in value))
        return value;
    if ('url' in value) {
        context.addIssue({ code: 'custom', path: ['uri'], message: 'set uri or url, not both: they are one setting' });
        return value;
    }
    const { uri, ...rest } = value;
    return { ...rest, url: uri };
}, z.strictObject({
    type: z.literal('neo4j').default('neo4j'),
    url: z.string().default('bolt://localhost:7687'),
    database: z.string().min(1).optional(),
    username: z.string().default('neo4j'),
    passwordEnv: z.string().min(1).optional(),
    /** Every node carries this, so checkouts can share one database. Defaults to one unique to the checkout. */
    scope: z.string().min(1).optional(),
    /**
     * Answer searches by having a local Ollama model write a read-only Cypher
     * query against the graph's schema. Without it - or when its query fails
     * or finds nothing - search is full-text matches and the paths from them.
     */
    cypher: z.strictObject(ollamaModelSchema.shape).optional(),
    /**
     * How far a search reaches from each full-text match: up to `hops`
     * relationships (default 2), each of confidence at least `minConfidence`
     * (default 0), and of the `rels` named when set. Every field is optional.
     */
    traverse: z
        .strictObject({
        hops: z.number().int().min(1).max(MAX_HOPS).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        rels: z.array(z.string().min(1)).min(1).optional()
    })
        .optional()
}));
