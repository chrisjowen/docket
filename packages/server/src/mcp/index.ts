/**
 * A workspace's MCP endpoint: the eleven tools - search, get, ask and the
 * ontology to read; remember, update notes, add evidence, retire, supersede,
 * propose and publish an ontology change to write - over the Postgres store
 * and a query service, and `handleMcp`, the request pipeline in front of
 * them as one framework-free `Request` to `Response` function.
 */
export { argumentsOf, isObject } from './args.js'
export { ModelCallRefused, UNTRUSTED_NOTE, failed, type ServerTool, type ToolContext } from './context.js'
export {
  CORS_HEADERS,
  MAX_BODY_BYTES,
  PROTOCOL_VERSIONS,
  bearerChallenge,
  bearerOf,
  credentialInUrl,
  handleMcp,
  protectedResourceMetadataUrl,
  type McpHandlerOptions
} from './handler.js'
export {
  MIN_CONFIDENCE_IGNORED,
  QUERY_PATHS,
  QueryError,
  SEARCH_BACKENDS,
  queryAuthorised,
  queryClient,
  queryKey,
  searchScope,
  type AskQuery,
  type AskResponse,
  type QueryClient,
  type SearchBackend,
  type SearchChange,
  type SearchGraph,
  type SearchQuery,
  type WorkspaceMatch,
  type WorkspaceSearch
} from './query.js'
export {
  ASK_SCHEMA,
  CAP_MESSAGE,
  ONTOLOGY_SCHEMA,
  RESOURCE_SCHEMA,
  SERVER_INSTRUCTIONS,
  WRITE_TOOL_NAMES,
  addEvidenceTool,
  askTool,
  getTool,
  isWriteTool,
  ontologyTool,
  proposeOntologyTool,
  publishOntologyTool,
  readTools,
  registryFor,
  rememberTool,
  retireTool,
  scopeOf,
  searchTool,
  serverTools,
  supersedeTool,
  updateNotesTool,
  writeTools
} from './tools/index.js'
export { EVIDENCE_SCHEMA, WRITE_SCHEMA, optionalText, parseAttributes, parseEvidence, requiredText, writeAnswer } from './write-args.js'
