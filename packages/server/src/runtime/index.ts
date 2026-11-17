/**
 * The loops a server runs beside its endpoint: reconciliation, which brings
 * each workspace's projections up to its canonical documents from the
 * outbox, and the search pipeline, which answers `docket_search` and
 * `docket_ask` over those projections - fused, re-ranked and cut to what is
 * relevant. A deployment names its stores (`ScopeSource`) and projections.
 */
export {
  ATTEMPTS,
  BATCH_SIZE,
  ReconcileError,
  backoffMs,
  messageOf,
  projectInstance,
  reconciler,
  recordStatus,
  type ConnectedProjections,
  type InstanceReport,
  type ProjectionSet,
  type ProjectionTarget,
  type ReconcileDeps,
  type ReconcileResult,
  type Reconciler
} from './reconcile.js'
export { dueWorkspaces, outboxLoop, type Logger, type OutboxLoop, type OutboxLoopOptions } from './outbox.js'
export {
  MAX_RERANKED,
  POOL_PER_SOURCE,
  QueryFailure,
  SIGNALS,
  askProjections,
  changesFound,
  queryService,
  rankCandidates,
  searchBoard,
  searchCandidates,
  searchDepth,
  unopenedAdapter,
  type Asked,
  type BoardOptions,
  type Models,
  type QueryEvent,
  type QueryService,
  type QueryServiceDeps,
  type Ranked
} from './search.js'
export {
  Vocabulary,
  coverage,
  cut,
  featuresOf,
  queryTerms,
  relevanceOf,
  rerankText,
  tokensOf,
  unknownNames,
  vocabularyOf,
  type Candidate,
  type CutModel,
  type Indexed,
  type Placed
} from './relevance.js'
export { CUT_MODEL, RERANKED_FEATURES, RETRIEVAL_CUT_MODEL, RETRIEVAL_FEATURES } from './relevance-model.js'
/** Fitting a cut model, and scoring a search as docket's search evaluation scores it. */
export {
  K as EVAL_K,
  RATIOS as CUT_RATIOS,
  THRESHOLDS as CUT_THRESHOLDS,
  answersOf,
  balanced,
  fitCut,
  fitLogistic,
  macroScores,
  ndcgAt,
  scoresOf,
  type EvalQuestion,
  type Scores
} from './relevance-fit.js'
export { MAX_TEXTS, RERANKER_MODEL, RERANK_PATH, rerankerClient, type Reranker, type RerankerModel } from './reranker.js'
export { redactSecrets, workspaceScope } from './scope.js'
