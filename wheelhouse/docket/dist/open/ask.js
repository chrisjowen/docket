import { askProject } from '../query/ask.js';
import { toLegacyAnswer } from '../query/legacy.js';
import { indexStatus } from './graph.js';
/**
 * The legacy `GET /api/ask` answer, translated from the coordinator's: each
 * adapter's entity hits, the documents found and the canonical paths joining
 * them, with how far the index lags the files.
 */
export const ask = async (cwd, query, limit) => {
    const outcome = await askProject(cwd, { question: query, maxResults: limit, synthesis: false });
    const { resolved, entities, documents, broken } = outcome.snapshot;
    return toLegacyAnswer(outcome, await indexStatus(resolved, entities, documents, broken));
};
