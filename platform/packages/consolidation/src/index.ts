// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background consolidation (dreaming): after each enrichment run and every
 * four hours (the worker's `DOCKET_CONSOLIDATION_EVERY_HOURS`), for the
 * workspaces that turn enrichment on, supersedes records gone out of date -
 * an older record a newer one of its type clearly contradicts, kept on file
 * with until when it held and why - then walks every current resource's
 * neighbourhood - its direct links and theirs, with the evidence on them -
 * and has the org's AI write a narrative summary of what it shows, inside the
 * enrichment job's monthly AI limit and the org's cap. Each summary goes into
 * the resource's own summary document under `.docket/~inferred/`, as
 * frontmatter `summary` with its model, confidence and cited evidence,
 * replacing the last one, which stays recorded as superseded. No document a
 * person, repo or checkout wrote is touched. A resource whose neighbourhood
 * has not changed since its last summary is skipped, and a near-duplicate's
 * summary is retired in favour of the one it duplicates. A summary gone out
 * of date with nothing to replace it is retired too.
 */
export { runConsolidation } from './run.js'
export type { RunDeps, RunOutcome, Summarizer } from './run.js'
export {
  CONSOLIDATION_EVERY_MS,
  CONSOLIDATION_LIMITS,
  checkpoints,
  contradictionChecks,
  dueWorkspaces,
  failStaleRuns,
  finishRun,
  recentRuns,
  recordContradictionCheck,
  startRun,
  touchCheckpoint,
} from './runs.js'
export type { ConsolidationRun, RunStatus, RunSummary, Schedule } from './runs.js'
export {
  contradictionCandidates,
  contradictionPrompt,
  explicitReason,
  heldUntil,
  judge,
  observed,
  pairFingerprint,
  readJudgement,
  statesReplacement,
  type Candidate,
  type Judgement,
  type Verdict,
} from './contradict.js'
export { fingerprintOf, summarize, summaryPrompt, type SummaryModel, type SummaryResult } from './summarize.js'
export { duplicateCandidates, indexGraph, walkNeighbourhood, type GraphIndex, type Neighbourhood } from './walk.js'
export { CONSOLIDATION_ACTOR, CONSOLIDATION_LABEL, consolidationWriter, retireSummary, writeSummary, type RetireReason, type SummaryFrontmatter } from './write.js'
