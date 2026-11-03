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
export { filesystemSource } from './canonical/source.js';
export { fileManifestStore } from './manifest/store.js';
/** The transport-free MCP server (docs/mcp.md), over a canonical source, with the tools of a registry. */
export { createMcpServer, InvalidArgumentsError, searchTool } from './mcp/server.js';
export { AskCancelledError, AskRequestError } from './query/ask.js';
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from './commands/graph.js';
