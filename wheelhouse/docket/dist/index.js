/**
 * The programmatic API: open a project's docket, with adapters loaded by
 * module reference or registered directly (docs/adapter-spec.md §4, §12).
 */
export { createDocket, openDocket, DEFAULT_SCOPE } from './adapters/docket.js';
export { loadAdapterDefinition } from './adapters/loader.js';
/**
 * The ports core reads through: where canonical documents come from, and
 * where sync keeps each instance's manifest. The project's files are the
 * default of both.
 */
export { filesystemSource, readCanonical } from './canonical/source.js';
export { fileManifestStore } from './manifest/store.js';
/**
 * Sync over a canonical source, into instances whose manifests a store
 * keeps: `docket sync` itself, for a host. Its parts are exported too - the
 * canonical inputs, each instance's plan and what its manifest records - so
 * a host that reports or reconciles reads them as sync does and never
 * invents a second rule.
 */
export { syncSource as sync, SyncError } from './commands/sync.js';
export { canonicalState } from './sync/inputs.js';
export { planAdapter } from './manifest/plan.js';
export { Checkpoint, emptyRecords, INPUT_KINDS, resetPendingFingerprint } from './manifest/adapter-manifest.js';
export { unacknowledged } from './bundled/contracts/dist/index.js';
/**
 * Validation as `docket validate` does it, over any canonical source, and
 * its parts, so a host validates exactly as docket does and never invents a
 * second rule. `ValidationDiagnostic` is what validation reports; the
 * `Diagnostic` exported with the adapter contracts is an adapter's.
 */
export { validate } from './commands/validate.js';
export { parseOntology } from './ontology/loader.js';
export { MATTER_OPTIONS, parseMemoryFile } from './source/parser.js';
export { hashContent } from './source/hashing.js';
export { validateDocuments } from './ontology/validator.js';
export { aggregate } from './evidence/aggregate.js';
export { confidenceModel } from './evidence/confidence.js';
export { memoryConfigSchema } from './config/config.js';
export { ATTRIBUTE_TYPES, EVIDENCE_LOCATION_FIELDS, error, ontologySchema, warning } from './model/index.js';
export { FALLBACK_ICON, ICON_NAMES, iconFor, isIconName } from './ontology/icons.js';
/** The graph `docket open` browses, read from any canonical source. */
export { readGraph } from './open/graph.js';
/** The transport-free MCP server (docs/mcp.md), over a canonical source, with the tools of a registry. */
export { createMcpServer, InvalidArgumentsError, searchTool } from './mcp/server.js';
/** What `docket_search` finds, as its MCP app draws it and as text. */
export { MAX_SEARCH_LIMIT, searchText } from './mcp/search.js';
export { SEARCH_SCHEMA } from './mcp/types.js';
/**
 * Asking over a snapshot of what `validate` read, with the coordinator,
 * synthesis prompt and citations `docket ask` uses.
 */
export { AskCancelledError, AskRequestError, askWith } from './query/ask.js';
export { snapshotOf } from './query/snapshot.js';
export { toSearchResult } from './query/legacy.js';
export { citationsIn, synthesisPrompt } from './query/synthesis.js';
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from './commands/graph.js';
/**
 * The kit docket's bundled adapters are built with. The bundled Neo4j and
 * mem0 adapters' parts are at `@chrisjowen/docket/adapters/neo4j` and
 * `@chrisjowen/docket/adapters/mem0`.
 */
export { entityProjectionAdapter } from './bundled/adapter-kit/dist/index.js';
