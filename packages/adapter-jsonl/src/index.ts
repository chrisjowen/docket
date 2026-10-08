import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '@docket/adapter-kit'

import { createJsonlProjection, jsonlConfigSchema, type JsonlConfig } from './jsonl-projection.js'

export {
  createJsonlProjection,
  DOCUMENTS_FILENAME,
  EDGES_FILENAME,
  jsonlConfigSchema,
  NODES_FILENAME,
  type DocumentRecord,
  type EdgeRecord,
  type JsonlConfig,
  type NodeRecord
} from './jsonl-projection.js'
export { lexicalSearch } from './lexical-search.js'

/**
 * The JSONL adapter: the merged entities written out as `documents.jsonl`,
 * `nodes.jsonl` and `edges.jsonl`, searched lexically. No service, no driver,
 * no network - docket's default lightweight adapter.
 */
const definition = entityProjectionDefinition<JsonlConfig>({
  name: 'jsonl',
  version: packageVersion(new URL('../package.json', import.meta.url)),
  rebuild: 'deterministic',
  validateConfig: (input) => parseAdapterConfig(jsonlConfigSchema, input),
  createProjection: (config) => createJsonlProjection(config)
})

export default definition
