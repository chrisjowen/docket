/**
 * The programmatic API: open a project's docket, with adapters loaded by
 * module reference or registered directly (docs/adapter-spec.md §4, §12).
 */
export { createDocket, openDocket, DEFAULT_SCOPE } from './adapters/docket.js';
export { loadAdapterDefinition } from './adapters/loader.js';
export { AskCancelledError, AskRequestError } from './query/ask.js';
export { GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from './commands/graph.js';
