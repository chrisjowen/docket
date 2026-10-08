import { packageVersion } from '@docket/adapter-kit'
import type { AdapterDefinition } from '@docket/contracts'

import { memvidConfigSchema, type MemvidConfig } from './config.js'
import { createMemvidAdapter } from './memvid-adapter.js'

export { memvidConfigSchema, type MemvidConfig } from './config.js'
export { createMemvidAdapter, DEFAULT_FILENAME, MEMVID_INPUTS, type MemvidAdapterOptions } from './memvid-adapter.js'
export { lexicalQuery, MemvidCommandError, MemvidStore, stripFrameMetadata } from './memvid-store.js'
export { memvidEnvironment, MemvidUnavailableError, spawnRunner, type CommandResult, type CommandRunner } from './runner.js'
export { frameUri, namespacePrefix, parseFrameUri } from './uri.js'

const version = packageVersion(new URL('../package.json', import.meta.url))

/**
 * The memvid adapter: entities, observations and documents as frames of a
 * single `.mv2` file, searched with memvid's lexical index, through the
 * memvid CLI the user installs. No service, no runtime group, no network.
 */
const definition: AdapterDefinition<MemvidConfig> = {
  apiVersion: 1,
  name: 'memvid',
  validateConfig: (input) => memvidConfigSchema.parse(input ?? {}),
  create: async (config, services) => createMemvidAdapter(config, services, { version })
}

export default definition
