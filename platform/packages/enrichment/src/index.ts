// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background enrichment: an optional job per workspace, off until someone
 * turns it on, that infers what the documents imply but never state - links
 * named in descriptions and attributes or shared names, missing owners,
 * duplicates and the contradictions between them - and writes each straight
 * into the workspace as a document of its own, with `inferred` evidence that
 * gives its reasoning and cites where it was read. Candidates the rules leave
 * open go to the org's AI, within the job's own monthly limit inside the
 * org's cap. A run's inferences retire together.
 */
export { CONTRADICTS_REL, DUPLICATE_REL, OWNER_REL, detect, fingerprint, fitting } from './detect.js'
export type { Candidate, Cited, DetectInput, InferenceKind } from './detect.js'
export { EnrichmentLimitReached, REVIEW_BATCH, briefOf, parseVerdicts, review, reviewPrompt } from './judge.js'
export type { Brief, Reviewer, Verdict } from './judge.js'
export { INFERRED_SOURCE, NoOntology, ensureEnrichmentOntology, ontologyAdditions, registersInferred } from './ontology.js'
export {
  ENRICHMENT_ACTOR,
  ENRICHMENT_LABEL,
  enrichmentAiActor,
  enrichmentWriter,
  evidenceOf,
  inferredPath,
  retireRun,
  runEnrichment,
} from './run.js'
export type { RunDeps, RunOutcome } from './run.js'
export {
  ENRICHMENT_LIMITS,
  EnrichmentSettingsError,
  RUN_HOUR_UTC,
  SCHEDULES,
  dueWorkspaces,
  enrichmentSettings,
  failStaleRuns,
  finishRun,
  isSchedule,
  knownFingerprints,
  nextRun,
  recentRuns,
  requestRun,
  runById,
  saveSettings,
  startRun,
} from './settings.js'
export type { EnrichmentRun, EnrichmentSettings, RunStatus, RunSummary, Schedule } from './settings.js'
