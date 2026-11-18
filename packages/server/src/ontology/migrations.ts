/** Moved to docket's workspace core (workspace/ontology/migrations), which docket's local MCP server writes through too; re-exported for the server core. */
export { type Migration, MIGRATION_OPS, migrationSteps, describeMigration, migrationProblems, rewriteDocument } from '../docket.js'
