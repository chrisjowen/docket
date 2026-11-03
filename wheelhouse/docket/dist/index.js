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
 * Validation as `docket validate` does it, over any canonical source, and
 * its parts, so a host validates exactly as docket does and never invents a
 * second rule. `ValidationDiagnostic` is what validation reports; the
 * `Diagnostic` exported with the adapter contracts is an adapter's.
 */
export { validate } from './commands/validate.js';
export { parseOntology } from './ontology/loader.js';
export { parseMemoryFile } from './source/parser.js';
export { hashContent } from './source/hashing.js';
export { validateDocuments } from './ontology/validator.js';
export { aggregate } from './evidence/aggregate.js';
export { confidenceModel } from './evidence/confidence.js';
export { memoryConfigSchema } from './config/config.js';
export { ATTRIBUTE_TYPES, EVIDENCE_LOCATION_FIELDS, error, ontologySchema, warning } from './model/index.js';
export { FALLBACK_ICON, ICON_NAMES, isIconName } from './ontology/icons.js';
/** The transport-free MCP server (docs/mcp.md), over a canonical source, with the tools of a registry. */
export { createMcpServer, InvalidArgumentsError, searchTool } from './mcp/server.js';
export { AskCancelledError, AskRequestError } from './query/ask.js';
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from './commands/graph.js';
