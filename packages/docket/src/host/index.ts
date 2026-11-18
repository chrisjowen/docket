/**
 * What a server hosting a project's docket for other people and agents
 * (`docket serve`, built on `@chrisjowen/docket-server`) runs it with: the
 * project's config, its writes taken in turn across processes, its
 * projections kept up to its files, the documents API `docket cloud
 * push|pull` call, and `docket open`'s page and reads as one request handler.
 */
export { CONFIG_FILENAME, summarizeConfigSchema, type ResolvedConfig, type SummarizeConfig } from '../config/config.js'
export { defaultConfig, findConfigFile, loadConfig } from '../config/loader.js'
export { LOCK_WAIT_MS, STALE_LOCK_MS, lockFile, withLockFile, writeLock } from '../mcp/local/files.js'
export { ProjectIndexer, type ProjectIndexerOptions } from './indexer.js'
export {
  PUSHED_FILE,
  listProjectDocuments,
  pushToProject,
  type ProjectDocument,
  type PushDiagnostic,
  type PushInput,
  type PushResult,
  type PushedRecord
} from './documents.js'
export { defaultUiDir, readViews, type ReadViewsOptions } from '../open/server.js'
export type { UiSyncRun, UiSyncStatus } from '../open/types.js'
export type { SyncResult } from '../commands/sync.js'
/** The model a `summarize` config names, as `docket ask` summarises with it. */
export { summarizerFor } from '../query/synthesis.js'
