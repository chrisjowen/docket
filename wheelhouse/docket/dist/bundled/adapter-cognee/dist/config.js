import { z } from '../../../vendor/zod.js';
/** cognee's rule for dataset names (1.6.8, `check_dataset_name`): no dots and no spaces. */
export const isDatasetName = (name) => name.length > 0 && !/[.\s]/.test(name);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The completion searches that answer with cited text, which `completion` may name. */
export const COMPLETION_TYPES = ['GRAPH_COMPLETION', 'RAG_COMPLETION', 'HYBRID_COMPLETION'];
/**
 * A cognee server - self-hosted, or any deployment of its REST API - and the
 * one dataset this instance files into. Unknown fields are refused rather
 * than dropped.
 */
export const cogneeConfigSchema = z.strictObject({
    /** The server's base URL, e.g. `http://localhost:8000`. docket never starts one. */
    url: z.string().url(),
    /**
     * The environment variable holding a cognee API key, sent as `X-Api-Key`.
     * Unset is fine for a server run with authentication off.
     */
    apiKeyEnv: z.string().regex(ENV_NAME, 'apiKeyEnv must be an environment variable name').default('COGNEE_API_KEY'),
    /**
     * The dataset this instance's scope is filed in. Defaults to one unique to
     * the checkout, so two projects on one server never share a dataset.
     */
    dataset: z.string().refine(isDatasetName, 'dataset must be a cognee dataset name: no dots and no spaces').optional(),
    /** The canonical input kinds projected. Each one cognify reads costs model calls, so entities only by default. */
    inputs: z
        .array(z.enum(['entity', 'observation', 'document']))
        .min(1)
        .default(['entity'])
        .transform((kinds) => [...new Set(kinds)]),
    /** Chunks whose cosine distance to the question is above this are left out. cognee always returns its top k otherwise. */
    maxDistance: z.number().min(0).max(2).optional(),
    /**
     * Also ask cognee for an answer with this completion search, citing the
     * chunks it used: shown as a derived fact. Costs one model call per question.
     */
    completion: z.enum(COMPLETION_TYPES).optional(),
    /** Bounds each request; an ask is bounded by its deadline as well. */
    timeoutMs: z.number().int().positive().default(60_000),
    /** Bounds cognify, which runs a model over every new chunk. */
    cognifyTimeoutMs: z.number().int().positive().default(3_600_000)
});
