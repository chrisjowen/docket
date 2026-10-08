import { packageVersion } from '@docket/adapter-kit'
import type { AdapterDefinition } from '@docket/contracts'

import { mempalaceConfigSchema, type MempalaceConfig } from './config.js'
import { createMempalaceAdapter } from './mempalace-adapter.js'

export { isPalaceName, mempalaceConfigSchema, type MempalaceConfig } from './config.js'
export {
  McpError,
  McpStdioClient,
  McpUnavailableError,
  MCP_PROTOCOL_VERSION,
  toolResultJson,
  type CallOptions,
  type McpServerOptions,
  type ToolClient
} from './mcp-client.js'
export {
  createMempalaceAdapter,
  MEMPALACE_INPUTS,
  PINNED_MEMPALACE,
  serverEnvironment,
  type MempalaceAdapterOptions
} from './mempalace-adapter.js'
export {
  defaultWing,
  drawerHeader,
  minilmDirectory,
  missingModel,
  PalaceStore,
  PalaceToolError,
  palaceName,
  parseSourceFile,
  roomFor,
  sourceFile,
  stripDrawerHeader
} from './palace-store.js'

const version = packageVersion(new URL('../package.json', import.meta.url))

/**
 * The MemPalace adapter: entities, observations and documents filed verbatim
 * as drawers in one wing of a palace, recalled with MemPalace's own search,
 * through the MemPalace MCP server the user installs. Python stays out of
 * process; nothing is installed or downloaded on its behalf.
 */
const definition: AdapterDefinition<MempalaceConfig> = {
  apiVersion: 1,
  name: 'mempalace',
  validateConfig: (input) => mempalaceConfigSchema.parse(input ?? {}),
  create: async (config, services) => createMempalaceAdapter(config, services, { version })
}

export default definition
