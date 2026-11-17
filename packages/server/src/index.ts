export { checkScope, effectiveScopes, type Refusal } from './auth/effective.js'
export { ROLES, isRole, type Role } from './auth/roles.js'
export { SCOPES, SCOPE_LABELS, impliedScopes, isScope, parseScopeString, roleScopes, type Scope } from './auth/scopes.js'
export { argumentsOf, isObject } from './mcp/args.js'
export { EVIDENCE_SCHEMA, WRITE_SCHEMA, optionalText, parseAttributes, parseEvidence, requiredText, writeAnswer } from './mcp/write-args.js'
export {
  DISPOSITIONS,
  breakingChange,
  checkDraft,
  classify,
  compare,
  diagnosticKey,
  evaluateDraft,
  parseDraft,
  type CheckResult,
  type Disposed,
  type Disposition,
  type DraftCheck,
  type Evaluation,
  type Rewrite,
  type StoredDocument,
  type Unresolved,
  type WorkspaceSnapshot
} from './ontology/check.js'
export { diffOntologies, type Change } from './ontology/diff.js'
export {
  BREAKING_CODES,
  MigrationInvalid,
  OntologyBreakingChange,
  OntologyInvalid,
  OntologyNarrowingChange,
  OntologyWriteDisabled,
  StaleDraft,
  VersionNotFound,
  isBreaking
} from './ontology/errors.js'
export { MIGRATION_OPS, describeMigration, migrationProblems, migrationSteps, rewriteDocument, type Migration } from './ontology/migrations.js'
export { mergePatch, proposedText, type Proposal } from './ontology/propose.js'
export { TEMPLATES, TEMPLATE_IDS, isTemplateId, template, type Template, type TemplateId } from './ontology/templates.js'
export { MAX_ONTOLOGY_BYTES, exportHeader, exportYaml, importYaml, lintOntology, sizeProblem, stripHeader, type Imported } from './ontology/yaml-io.js'
export { CodecError, defaultAad, localKeyCodec, plaintextCodec } from './codecs.js'
export { DOCUMENT_BYTES, DocumentError, checkDocument, cloudDocumentPath, pathProblem } from './documents.js'
export type { Origin } from './origin.js'
export type {
  AuditEventInput,
  AuditOutcome,
  AuditSink,
  Authenticator,
  Authorizer,
  DocumentCodec,
  DocumentRef,
  Limiter,
  McpMessage,
  McpResource,
  ModelGate,
  Principal,
  QueryBackend,
  ScopeSource,
  SealedBody,
  StoreContext,
  StoreLimits,
  StoreRunner,
  StoreScope,
  Tx
} from './ports.js'
export { changeNote, currentRecord, dayOf } from './supersession.js'
export {
  appendedNotes,
  composeDocument,
  renderDocument,
  sameMeaning,
  splitDocument,
  type ComposedDocument,
  type EvidenceGroup,
  type ResourceChange
} from './write/document.js'
export { evidenceProblems, hasErrors, refuse, stampEvidence, writeDiagnostics } from './write/evidence.js'
export {
  WRITE_LIMITS,
  type AddEvidenceInput,
  type AppendNotesInput,
  type Channel,
  type EvidenceInput,
  type LinkInput,
  type RememberInput,
  type StampedEvidence,
  type WriteOptions,
  type WriteResult,
  type Writer
} from './write/inputs.js'
