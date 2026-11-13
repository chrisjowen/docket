import { packageVersion, parseAdapterConfig } from '../../adapter-kit/dist/index.js';
import { cogneeConfigSchema } from './config.js';
import { createCogneeAdapter } from './cognee-adapter.js';
export { COMPLETION_TYPES, cogneeConfigSchema, isDatasetName } from './config.js';
export { CogneeClient, CogneeHttpError, CogneeUnavailableError, contentHash, DATA_PAGE } from './cognee-client.js';
export { createCogneeAdapter, parseCitedAnswer, PINNED_COGNEE } from './cognee-adapter.js';
export { CogneeStore, defaultDataset, disambiguation, identityMetadata, parseIdentity, renderEntity, retryableCogneeError, searchResults, stripDisambiguation } from './cognee-store.js';
const version = packageVersion(new URL('../package.json', import.meta.url));
/**
 * The cognee adapter: canonical inputs added to one cognee dataset and
 * cognified into its knowledge graph, recalled with cognee's own search,
 * through the REST API of a cognee server the user runs. Python stays out of
 * process; nothing is installed or started on its behalf.
 */
const definition = {
    apiVersion: 1,
    name: 'cognee',
    validateConfig: (input) => parseAdapterConfig(cogneeConfigSchema, input ?? {}),
    create: async (config, services) => createCogneeAdapter(config, services, { version })
};
export default definition;
