// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's ontology (§13): starter templates, drafts and published
 * versions, the change check that re-validates every document against a
 * draft, migrations for breaking changes, and YAML import and export.
 */
export {
  DISPOSITIONS,
  breakingChange,
  checkDraft,
  classify,
  diagnosticKey,
  evaluate,
  needsAcceptance,
  parseDraft,
  proposalChangesWith,
  rescoreWith,
  workspaceSnapshot,
} from './check.js'
export type { CheckResult, Classification, Disposed, Disposition, DraftCheck, ProposalChange, Rescored, Rewrite, Unresolved } from './check.js'
export { BUILT_IN_TAGS, builtInCatalogue, contentsOf, normaliseTags } from './catalogue.js'
export type { CatalogueEntry, Contents } from './catalogue.js'
export { diffOntologies } from './diff.js'
export {
  MAX_DOCKET_DRAFTS,
  acceptDocketDraft,
  checkNewDocket,
  createDocketDraft,
  discardDocketDraft,
  docketDraftById,
  listDocketDrafts,
  newDocketProblem,
  updateDocketDraft,
} from './docket-drafts.js'
export type { DocketDraft } from './docket-drafts.js'
export { ATTRIBUTE_KINDS, DRAFT_TOOL, MAX_DESCRIPTION, buildDraft, draftMessages, ontologyName, readPlan } from './drafting.js'
export type { DraftPlan, StartingPoint } from './drafting.js'
export type { Change } from './diff.js'
export {
  BREAKING_CODES,
  MigrationInvalid,
  OntologyBreakingChange,
  OntologyInvalid,
  OntologyNarrowingChange,
  OntologyWriteDisabled,
  StaleDraft,
  VersionNotFound,
  isBreaking,
} from './errors.js'
export { MIGRATION_OPS, describeMigration, migrationProblems, migrationSteps, rewriteDocument } from './migrations.js'
export type { Migration } from './migrations.js'
export {
  MAX_ORG_TEMPLATES,
  TemplateError,
  deleteOrgTemplate,
  listOrgTemplates,
  orgCatalogueEntry,
  orgTemplateById,
  orgTemplateId,
  orgTemplateKey,
  saveOrgTemplate,
  updateOrgTemplate,
} from './org-templates.js'
export type { OrgTemplate } from './org-templates.js'
export { mergePatch, proposeOntologyChange, proposedText, publishOntologyChange } from './propose.js'
export type { DirectChange, Proposal } from './propose.js'
export { TEMPLATES, TEMPLATE_IDS, isTemplateId, template } from './templates.js'
export type { Template, TemplateId } from './templates.js'
export {
  createDraft,
  discardDraft,
  headOf,
  listDrafts,
  listPublished,
  publish,
  rollback,
  updateDraft,
  versionById,
  versionByNumber,
} from './versions.js'
export type { OntologyVersion, PublishOptions, Published, Publisher } from './versions.js'
export { createWorkspace } from './workspaces.js'
export type { OntologyStart } from './workspaces.js'
export { MAX_ONTOLOGY_BYTES, exportHeader, exportYaml, importYaml, lintOntology, stripHeader } from './yaml-io.js'
export type { Imported } from './yaml-io.js'
