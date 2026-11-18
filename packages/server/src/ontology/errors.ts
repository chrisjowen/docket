/** Moved to docket's workspace core (workspace/ontology/errors), which docket's local MCP server writes through too; re-exported for the server core. */
export {
  OntologyInvalid,
  StaleDraft,
  OntologyBreakingChange,
  OntologyNarrowingChange,
  MigrationInvalid,
  OntologyWriteDisabled,
  VersionNotFound,
  BREAKING_CODES,
  isBreaking
} from '../docket.js'
