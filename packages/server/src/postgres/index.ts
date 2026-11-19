/**
 * The canonical store on Postgres: the schema as migrations a deployment runs
 * in one schema or one per tenant, a `StoreRunner` over a pool, and every
 * read and write of documents, the ontology's versions, the activity log,
 * supersessions, manifests and the outbox, each in the caller's transaction.
 * It imports no driver: a deployment passes its own pool (a `pg.Pool`).
 */
export { ident, newId, postgresStore, transaction, type Pool, type PoolClient, type PostgresStoreOptions } from './db.js'
export { CORE_MIGRATIONS, MigrationError, fillMigration, migrate, migrateSchema, migrationChecksum, type Migration } from './migrations.js'
export {
  countDocuments,
  documentHistory,
  listDocumentPage,
  listDocuments,
  openRow,
  putDocument,
  readDocument,
  readDocuments,
  resourceChanges,
  retireDocument,
  type DocumentPageQuery,
  type DocumentRecord,
  type ListedDocument,
  type OpenedDocument,
  type Revision
} from './documents.js'
export {
  CHANNELS,
  ingestActors,
  listIngests,
  recordIngest,
  type IngestAction,
  type IngestDetail,
  type IngestDocument,
  type IngestEvent,
  type IngestInput,
  type IngestOutcome,
  type IngestQuery,
  type LoggedAction,
  type LoggedDocument
} from './ingest.js'
export {
  checkDraft,
  createDraft,
  createWorkspace,
  discardDraft,
  evaluate,
  headOf,
  listDrafts,
  listPublished,
  proposeOntologyChange,
  publish,
  publishOntologyChange,
  rollback,
  updateDraft,
  versionById,
  versionByNumber,
  workspaceSnapshot,
  type DirectChange,
  type OntologyStart,
  type OntologyVersion,
  type PublishOptions,
  type Published,
  type Publisher
} from './ontology.js'
export { openText, sealText, type SealedColumns } from './sealing.js'
export { FAILURES_BEFORE_BEHIND, indexStatus, instanceStatuses, type IndexStatus, type InstanceStatus, type StatusRead } from './index-status.js'
export { NoPublishedOntology, postgresManifests, postgresSource, publishedOntology, workspaceResolvedConfig } from './source.js'
export {
  CHANGES_KEPT,
  HISTORY_DAYS,
  HISTORY_LIMIT,
  listSyncRuns,
  recordSyncRun,
  requestRecheck,
  syncStanding,
  type OutboxStanding,
  type ProjectionStanding,
  type SyncChange,
  type SyncInstanceRun,
  type SyncRun,
  type SyncRunInput,
  type SyncTrigger
} from './sync-runs.js'
export {
  addProposalEvidence,
  liveSupersessions,
  openProposals,
  pendingProposals,
  promoteProposals,
  rejectProposal,
  supersedeResource,
  type PendingProposal,
  type ProposalOutcome,
  type ProposalWriteResult,
  type SupersedeInput,
  type SupersedeOptions,
  type SupersedeResult,
  type Supersession,
  type SupersessionSource
} from './supersession.js'
export {
  ONTOLOGY_MCP_ROLES,
  WORKSPACE_SLUG,
  WorkspaceError,
  deleteWorkspace,
  enqueue,
  insertWorkspace,
  listWorkspaces,
  ontologyMcpRoles,
  pendingDeletions,
  recordPurge,
  setOntologyMcpRoles,
  workspaceById,
  workspaceBySlug,
  workspaceSlugProblem,
  type OntologyMcpRole,
  type PendingDeletion,
  type Workspace
} from './workspaces.js'
export {
  INFERRED_PROVENANCE,
  INFERRED_ROOT,
  addEvidence,
  appendNotes,
  describeResource,
  isInferredPath,
  lockOntologyHead,
  lockResource,
  retireResource,
  summaryPath,
  writeInference,
  writeResource,
  type InferenceInput,
  type RetireInput,
  type RetireResult
} from './write.js'
export { checkoutProblem, pushDocuments, type PushDiagnostic, type PushInput, type PushResult } from './push.js'
