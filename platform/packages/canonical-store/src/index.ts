// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where one org's canonical documents live: Postgres, in the org's own schema,
 * with every raw body encrypted under the org's DEK (§6.1, §7.3), read through
 * docket's `CanonicalSource` and `ManifestStore` ports.
 */
export {
  ATTRIBUTE_TYPES,
  CLOUD_ONTOLOGY_PATH,
  EVIDENCE_LOCATION_FIELDS,
  FALLBACK_ICON,
  ICON_NAMES,
  aggregate,
  assess,
  bandOf,
  cloudResolvedConfig,
  confidenceModel,
  explain,
  hashContent,
  parseMemoryFile,
  parseOntology,
  readCanonical,
  validateDocuments,
} from './docket.js'
export type {
  AdapterManifest,
  CanonicalDocument,
  CanonicalRead,
  CanonicalSource,
  Diagnostic,
  LoadedOntology,
  ManifestStore,
  MemoryDocument,
  MemoryEntity,
  Ontology,
  ResolvedConfig,
  UnreadableDocument,
  ValidateResult,
  ConfidenceModel,
  Explanation,
  PeopleDirectory,
  SourceRegistry,
  SourceTypeDefinition,
  Subject,
} from './docket.js'
export {
  MAX_ATTRIBUTES,
  NO_TRUST,
  TRUST_FINGERPRINT_SQL,
  TrustError,
  attestedAttributes,
  connectedRepositories,
  directoryOf,
  directoryPerson,
  listPeople,
  listRegistry,
  orgTrust,
  peopleDirectory,
  recordRepositoryAttributes,
  registerSource,
  removeMemberAttributes,
  repositoryKey,
  setMemberAttributes,
  sourceRegistry,
  trustChanged,
  trustModel,
  unregisterSource,
  validate,
} from './trust.js'
export type { Attested, AttestedValue, ConnectedRepository, DirectoryPerson, OrgTrust, RegisteredSource, TrustedSource } from './trust.js'
export {
  DocumentError,
  checkDocument,
  cloudDocumentPath,
  countDocuments,
  documentAad,
  listDocumentPage,
  listDocuments,
  openRow,
  pathProblem,
  putDocument,
  readDocument,
  readDocuments,
  resourceChanges,
  retireDocument,
} from './documents.js'
export type { DocumentPageQuery, DocumentRecord, ListedDocument, OpenedDocument, Origin, StoreContext } from './documents.js'
export { checkoutProblem, pushDocuments } from './push.js'
export type { PushDiagnostic, PushInput, PushResult } from './push.js'
export {
  CLOUD_PROJECTIONS,
  FAILURES_BEFORE_BEHIND,
  frontmatterOf,
  indexStatus,
  optionalStatus,
  workspaceGraph,
} from './graph.js'
export type { CloudEntity, CloudGraph, CloudIndexStatus, CloudProjection, InstanceStatus, PendingProposalView, UiGraph, UiIndexStatus } from './graph.js'
export { explainEntity, explainLink, explainProposal, grouped, summarise } from './explain.js'
export type { Band, Explained, ExplainedEvidence, PricedBy, ShownAttribute, SourceGroup, SourceLine, TrustSummary } from './explain.js'
export { KeyringError, keyring } from './keyring.js'
export type { Keyring, OrgKeyring } from './keyring.js'
export { NoPublishedOntology, postgresSource, publishedOntology } from './postgres-source.js'
export { postgresManifests } from './postgres-manifests.js'
export { CHANNELS, ingestActors, listIngests, recordIngest } from './ingest.js'
export { CHANGES_KEPT, HISTORY_DAYS, HISTORY_LIMIT, listSyncRuns, recordSyncRun, requestRecheck, syncStanding } from './sync-runs.js'
export type { OutboxStanding, ProjectionStanding, SyncChange, SyncInstanceRun, SyncRun, SyncRunInput, SyncTrigger } from './sync-runs.js'
export { listQueryTraces, recordQueryTrace } from './query-traces.js'
export type {
  QueryAuthor,
  QueryTool,
  QueryTrace,
  QueryTraceDetail,
  QueryTraceInput,
  TracedCall,
  TracedHit,
  TracedQuery,
  TracedReference,
  TracedStore,
} from './query-traces.js'
export type { Channel, IngestAction, IngestDetail, IngestDocument, IngestEvent, IngestInput, IngestOutcome, IngestQuery, LoggedAction, LoggedDocument } from './ingest.js'
export {
  INFERRED_PROVENANCE,
  INFERRED_ROOT,
  WRITE_LIMITS,
  addEvidence,
  appendNotes,
  describeResource,
  hasErrors,
  isInferredPath,
  lockOntologyHead,
  lockResource,
  retireResource,
  stampEvidence,
  summaryPath,
  writeInference,
  writeResource,
} from './write.js'
export type {
  AddEvidenceInput,
  AppendNotesInput,
  EvidenceInput,
  InferenceInput,
  LinkInput,
  RememberInput,
  RetireInput,
  RetireResult,
  StampedEvidence,
  WriteOptions,
  WriteResult,
  Writer,
} from './write.js'
export { CHAT_TITLE_MAX, CHATS_LISTED, WORKSPACE_DELETED_MARKER, appendChatMessages, chatTitle, createChat, deleteChat, listChats, purgeWorkspaceFromChats, readChat } from './chats.js'
export type { Chat, ChatMessage, ChatRole, ChatSummary, StoredChatMessage } from './chats.js'
export { documentHistory } from './revisions.js'
export type { Revision } from './revisions.js'
export {
  WorkspaceError,
  countMemberWorkspaces,
  deleteWorkspace,
  enqueue,
  insertWorkspace,
  listWorkspaces,
  pendingDeletions,
  recordPurge,
  workspaceById,
  workspaceBySlug,
  workspaceSlugProblem,
} from './workspaces.js'
export type { PendingDeletion, Workspace } from './workspaces.js'
export { insertSpace, listSpaces, newSpaceProblem, spaceById, spaceBySlug, spaceSlugProblem } from './spaces.js'
export type { Space } from './spaces.js'

export {
  addProposalEvidence,
  attestationsChanged,
  changeNote,
  confirmProposal,
  currentRecord,
  dayOf,
  listProposals,
  liveSupersessions,
  openProposals,
  overrideProposal,
  pendingProposals,
  promoteProposals,
  proposalById,
  proposalDetail,
  proposalModel,
  rejectProposal,
  snapshotProposals,
  supersedeResource,
} from './supersession.js'
export type {
  ListedProposal,
  PendingProposal,
  ProposalDetail,
  ProposalOutcome,
  ProposalWriteResult,
  SupersedeInput,
  SupersedeOptions,
  SupersedeResult,
  Supersession,
  SupersessionSource,
} from './supersession.js'

export { readWorkspace } from './workspace-read.js'

export {
  COGNEE,
  COGNEE_LIMITS,
  CogneeSettingsError,
  OPTIONAL_PROJECTIONS,
  cogneeAiActor,
  cogneeFloor,
  cogneeSettings,
  cogneeWork,
  forgetCognee,
  markCogneeProjected,
  saveCogneeSettings,
} from './cognee.js'
export type { CogneeSettings, CogneeWork, OptionalProjection } from './cognee.js'
