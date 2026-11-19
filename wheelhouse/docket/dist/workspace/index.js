/**
 * The workspace core every Docket MCP server writes through, whichever store
 * holds its documents: how a write becomes a docket document, the evidence
 * rules, supersession, and the ontology's change check, migrations and
 * proposals. docket's local MCP server runs it over the project's files;
 * `@chrisjowen/docket-server` runs it over Postgres.
 */
export { ONTOLOGY_PATH, parseOntology as parseWorkspaceOntology } from './docket.js';
export { DOCUMENT_BYTES, DocumentError, checkDocument, checkoutProblem, cloudDocumentPath, pathProblem } from './documents.js';
export { writableHere } from './origin.js';
export { changeNote, currentRecord, dayOf, recordChanges } from './supersession.js';
export { DISPOSITIONS, breakingChange, checkDraft, classify, compare, diagnosticKey, evaluateDraft, needsAcceptance, parseDraft, rescore } from './ontology/check.js';
export { diffOntologies } from './ontology/diff.js';
export { BREAKING_CODES, MigrationInvalid, OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange, OntologyWriteDisabled, StaleDraft, VersionNotFound, isBreaking } from './ontology/errors.js';
export { MIGRATION_OPS, describeMigration, migrationProblems, migrationSteps, rewriteDocument } from './ontology/migrations.js';
export { mergePatch, proposedText } from './ontology/propose.js';
export { MAX_ONTOLOGY_BYTES, exportHeader, exportYaml, importYaml, lintOntology, sizeProblem, stripHeader } from './ontology/yaml-io.js';
export { appendedNotes, composeDocument, renderDocument, sameMeaning, splitDocument } from './write/document.js';
export { evidenceKey, evidenceProblems, hasErrors, orderedEvidence, refuse, stampAll, stampContext, stampEvidence, writeDiagnostics } from './write/evidence.js';
export { WRITE_LIMITS } from './write/inputs.js';
