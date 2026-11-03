/**
 * The programmatic API: open a project's docket, with adapters loaded by
 * module reference or registered directly (docs/adapter-spec.md §4, §12).
 */
export {
  createDocket,
  openDocket,
  DEFAULT_SCOPE,
  type AdapterModuleReference,
  type AdapterRegistration,
  type AdapterSlot,
  type CreateDocketOptions,
  type Docket,
  type OpenDocketOptions
} from './adapters/docket.js'
export { loadAdapterDefinition } from './adapters/loader.js'
/**
 * The ports core reads through: where canonical documents come from, and
 * where sync keeps each instance's manifest. The project's files are the
 * default of both.
 */
export {
  filesystemSource,
  type CanonicalDocument,
  type CanonicalSource,
  type UnreadableDocument
} from './canonical/source.js'
export { fileManifestStore, type ManifestStore } from './manifest/store.js'
export type { AdapterManifest } from './manifest/adapter-manifest.js'
/** The transport-free MCP server (docs/mcp.md), over a canonical source, with the tools of a registry. */
export {
  createMcpServer,
  InvalidArgumentsError,
  searchTool,
  type McpServer,
  type McpServerOptions,
  type Tool,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult
} from './mcp/server.js'
export { AskCancelledError, AskRequestError, type AskInput } from './query/ask.js'
export type * from './query/wire.js'
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION, type GraphContract } from './commands/graph.js'
export type { AdapterDistribution, TypeScriptRunner } from './adapters/resolve-module.js'
export type * from '@docket/contracts'
