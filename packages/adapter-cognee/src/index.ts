import { packageVersion, parseAdapterConfig } from '@docket/adapter-kit'
import type { AdapterDefinition } from '@docket/contracts'

import { cogneeConfigSchema, type CogneeConfig } from './config.js'
import { createCogneeAdapter } from './cognee-adapter.js'

export { COMPLETION_TYPES, cogneeConfigSchema, isDatasetName, type CogneeConfig } from './config.js'
export {
  CogneeClient,
  CogneeHttpError,
  CogneeUnavailableError,
  contentHash,
  DATA_PAGE,
  type CogneeChunk,
  type CogneeClientOptions,
  type CogneeData,
  type CogneeHealth,
  type RequestOptions
} from './cognee-client.js'
export { createCogneeAdapter, parseCitedAnswer, PINNED_COGNEE, type CitedAnswer, type CogneeAdapterOptions } from './cognee-adapter.js'
export {
  CogneeStore,
  defaultDataset,
  disambiguation,
  identityMetadata,
  parseIdentity,
  renderEntity,
  retryableCogneeError,
  searchResults,
  stripDisambiguation,
  type CogneeSearch
} from './cognee-store.js'

const version = packageVersion(new URL('../package.json', import.meta.url))

/**
 * The cognee adapter: canonical inputs added to one cognee dataset and
 * cognified into its knowledge graph, recalled with cognee's own search,
 * through the REST API of a cognee server the user runs. Python stays out of
 * process; nothing is installed or started on its behalf.
 */
const definition: AdapterDefinition<CogneeConfig> = {
  apiVersion: 1,
  name: 'cognee',
  validateConfig: (input) => parseAdapterConfig(cogneeConfigSchema, input ?? {}),
  create: async (config, services) => createCogneeAdapter(config, services, { version })
}

export default definition
