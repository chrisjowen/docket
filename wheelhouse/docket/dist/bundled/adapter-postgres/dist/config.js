import { semanticConfigSchema } from '../../adapter-kit/dist/index.js';
import { z } from '../../../vendor/zod.js';
/** The furthest an answer follows links from a match: a recursive query past two hops reaches most of a graph. */
export const MAX_HOPS = 2;
/** A schema or text search configuration name, written into SQL: lowercase letters, digits and underscores only. */
const sqlName = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'lowercase letters, digits and "_", starting with a letter or "_"');
/**
 * Entities and their links in Postgres 16 or later. The connection is `url`,
 * or the URL in the environment variable `urlEnv`, or else the libpq
 * environment (`PGHOST`, `PGUSER`, ...). A password is read from
 * `passwordEnv` when set, never from the file.
 */
export const postgresConfigSchema = z
    .strictObject({
    type: z.literal('postgres').default('postgres'),
    url: z.string().min(1).optional(),
    urlEnv: z.string().min(1).optional(),
    passwordEnv: z.string().min(1).optional(),
    /** The schema the adapter's tables live in, created when missing. */
    schema: sqlName.default('docket_index'),
    /** Every row carries this, so checkouts can share one database. Defaults to one unique to the checkout. */
    scope: z.string().min(1).optional(),
    /** The text search configuration full-text search stems and drops stop words with. */
    language: sqlName.default('english'),
    /** Lift matches whose title is close to the query, through pg_trgm: names, and names misspelt. */
    trigram: z.boolean().default(true),
    /** Embed each entity and search by meaning too, through adapter-kit's Ollama embedder. Needs the pgvector extension. */
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
    .refine((config) => !(config.url && config.urlEnv), { path: ['urlEnv'], message: 'set url or urlEnv, not both' })
    .refine((config) => config.search === undefined || config.search === 'lexical' || config.semantic !== undefined, {
    path: ['search'],
    message: 'semantic and hybrid search need the semantic section, which says how entities are embedded'
});
/** How the config searches, its default resolved. */
export const searchModeOf = (config) => config.search ?? (config.semantic ? 'hybrid' : 'lexical');
