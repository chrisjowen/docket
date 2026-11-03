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
  readCanonical,
  type CanonicalDocument,
  type CanonicalRead,
  type CanonicalSource,
  type UnreadableDocument
} from './canonical/source.js'
export { fileManifestStore, type ManifestStore } from './manifest/store.js'
export type { AdapterManifest } from './manifest/adapter-manifest.js'
/**
 * Validation as `docket validate` does it, over any canonical source, and
 * its parts, so a host validates exactly as docket does and never invents a
 * second rule. `ValidationDiagnostic` is what validation reports; the
 * `Diagnostic` exported with the adapter contracts is an adapter's.
 */
export { validate, type ValidateOptions, type ValidateResult } from './commands/validate.js'
export { parseOntology, type LoadedOntology } from './ontology/loader.js'
export { parseMemoryFile, type ParseResult } from './source/parser.js'
export { hashContent } from './source/hashing.js'
export {
  validateDocuments,
  type ValidateOptions as ValidateDocumentsOptions
} from './ontology/validator.js'
export { aggregate, type AggregateResult } from './evidence/aggregate.js'
export { confidenceModel, type ConfidenceModel } from './evidence/confidence.js'
export { memoryConfigSchema, type MemoryConfig, type ResolvedConfig } from './config/config.js'
export {
  ATTRIBUTE_TYPES,
  EVIDENCE_LOCATION_FIELDS,
  error,
  ontologySchema,
  warning,
  type Diagnostic as ValidationDiagnostic,
  type MemoryDocument,
  type MemoryEntity,
  type Ontology
} from './model/index.js'
export { FALLBACK_ICON, ICON_NAMES, isIconName, type IconName } from './ontology/icons.js'
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
