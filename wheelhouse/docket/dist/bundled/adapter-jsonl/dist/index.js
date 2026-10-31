import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '../../adapter-kit/dist/index.js';
import { createJsonlProjection, jsonlConfigSchema } from './jsonl-projection.js';
export { createJsonlProjection, DOCUMENTS_FILENAME, EDGES_FILENAME, jsonlConfigSchema, NODES_FILENAME } from './jsonl-projection.js';
export { lexicalSearch } from './lexical-search.js';
/**
 * The JSONL adapter: the merged entities written out as `documents.jsonl`,
 * `nodes.jsonl` and `edges.jsonl`, searched lexically. No service, no driver,
 * no network - docket's default lightweight adapter.
 */
const definition = entityProjectionDefinition({
    name: 'jsonl',
    version: packageVersion(new URL('../package.json', import.meta.url)),
    rebuild: 'deterministic',
    validateConfig: (input) => parseAdapterConfig(jsonlConfigSchema, input),
    createProjection: (config) => createJsonlProjection(config)
});
export default definition;
