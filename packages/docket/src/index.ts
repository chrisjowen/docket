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
/**
 * Sync over a canonical source, into instances whose manifests a store
 * keeps: `docket sync` itself, for a host. Its parts are exported too - the
 * canonical inputs, each instance's plan and what its manifest records - so
 * a host that reports or reconciles reads them as sync does and never
 * invents a second rule.
 */
export {
  syncSource as sync,
  SyncError,
  type SyncProgress,
  type SyncResult,
  type SyncSourceOptions,
  type SyncTarget
} from './commands/sync.js'
export { canonicalState, type CanonicalState } from './sync/inputs.js'
export { planAdapter, type PlannedChange } from './manifest/plan.js'
export {
  Checkpoint,
  emptyRecords,
  INPUT_KINDS,
  resetPendingFingerprint,
  type AdapterManifest
} from './manifest/adapter-manifest.js'
export { unacknowledged } from '@docket/contracts'
/**
 * Validation as `docket validate` does it, over any canonical source, and
 * its parts, so a host validates exactly as docket does and never invents a
 * second rule. `ValidationDiagnostic` is what validation reports; the
 * `Diagnostic` exported with the adapter contracts is an adapter's.
 */
export { validate, type ValidateOptions, type ValidateResult } from './commands/validate.js'
export { parseOntology, type LoadedOntology } from './ontology/loader.js'
export { MATTER_OPTIONS, parseMemoryFile, type ParseResult } from './source/parser.js'
export { hashContent } from './source/hashing.js'
export {
  validateDocuments,
  type ValidateOptions as ValidateDocumentsOptions
} from './ontology/validator.js'
export { aggregate, type AggregateResult } from './evidence/aggregate.js'
export { confidenceModel, type ConfidenceModel } from './evidence/confidence.js'
export { memoryConfigSchema, type MemoryConfig, type ResolvedConfig } from './config/config.js'
/** The starting ontologies `docket init --template` offers, by name: absolute paths to the bundled yaml. */
export { ONTOLOGY_TEMPLATES } from './config/defaults.js'
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
export { FALLBACK_ICON, ICON_NAMES, iconFor, isIconName, type IconName } from './ontology/icons.js'
/** The graph `docket open` browses, read from any canonical source. */
export { readGraph } from './open/graph.js'
export type { UiAssessment, UiEdge, UiEntity, UiGraph, UiIndexStatus } from './open/types.js'
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
/** What `docket_search` finds, as its MCP app draws it and as text. */
export { MAX_SEARCH_LIMIT, searchText } from './mcp/search.js'
export {
  SEARCH_SCHEMA,
  type SearchGraph,
  type SearchLink,
  type SearchNode,
  type SearchPath
} from './mcp/types.js'
/**
 * Asking over a snapshot of what `validate` read, with the coordinator,
 * synthesis prompt and citations `docket ask` uses.
 */
export { AskCancelledError, AskRequestError, askWith, type AskInput, type AskOutcome } from './query/ask.js'
export { snapshotOf } from './query/snapshot.js'
export { toSearchResult } from './query/legacy.js'
export { citationsIn, LOW_CONFIDENCE, synthesisDiagnostics, synthesisPrompt } from './query/synthesis.js'
export type * from './query/wire.js'
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION, type GraphContract } from './commands/graph.js'
export type { AdapterDistribution, TypeScriptRunner } from './adapters/resolve-module.js'
export type * from '@docket/contracts'
/**
 * The kit docket's bundled adapters are built with. The bundled Neo4j and
 * mem0 adapters' parts are at `@chrisjowen/docket/adapters/neo4j` and
 * `@chrisjowen/docket/adapters/mem0`.
 */
export { entityProjectionAdapter, type Chat } from '@docket/adapter-kit'
