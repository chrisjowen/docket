import { semanticConfigSchema } from '../../adapter-kit/dist/index.js';
import { z } from '../../../vendor/zod.js';
/** The furthest an answer follows links from a match: a recursive query past two hops reaches most of a graph. */
export const MAX_HOPS = 2;
/** The file the index lives in when `file` is unset, in the instance's own state directory. */
export const DEFAULT_FILE = 'index.sqlite';
/**
 * Entities and their links in one SQLite file, which needs no server: `file`,
 * relative to `.docket.yaml`, or `index.sqlite` in the instance's own state
 * directory (under `.docket/.index`, so it is never committed).
 */
export const sqliteConfigSchema = z
    .strictObject({
    type: z.literal('sqlite').default('sqlite'),
    file: z.string().min(1).optional(),
    /** Every row carries this, so checkouts can share one file. Defaults to one unique to the checkout. */
    scope: z.string().min(1).optional(),
    /**
     * Embed each entity and search by meaning too, through adapter-kit's
     * Ollama embedder. Vectors are compared in the adapter itself, one by one,
     * so no SQLite extension is needed; that suits up to tens of thousands of
     * entities.
     */
    semantic: semanticConfigSchema.optional(),
    /**
     * How a search ranks: by full-text (`lexical`), by embedding (`semantic`),
     * or both fused by reciprocal rank (`hybrid`). Defaults to `hybrid` when
     * `semantic` is set and `lexical` otherwise.
     */
    search: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
    /**
     * How far an answer reaches from each match: up to `hops` links (default
     * 2), each of confidence at least `minConfidence` (default 0), and of the
     * `rels` named when set. Every field is optional.
     */
    traverse: z
        .strictObject({
        hops: z.number().int().min(1).max(MAX_HOPS).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        rels: z.array(z.string().min(1)).min(1).optional()
    })
        .optional()
})
    .refine((config) => config.search === undefined || config.search === 'lexical' || config.semantic !== undefined, {
    path: ['search'],
    message: 'semantic and hybrid search need the semantic section, which says how entities are embedded'
});
/** How the config searches, its default resolved. */
export const searchModeOf = (config) => config.search ?? (config.semantic ? 'hybrid' : 'lexical');
