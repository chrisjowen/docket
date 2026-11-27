// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Docket Cloud GitHub App (§14.1, §14.3): installation tokens and a REST
 * client, webhook verification and routing, reading a connection's docket
 * files with the Git Trees API, and opening export PRs.
 */
export { GitHubApiError, appJwt, githubApp, githubAppConfigFromEnv, readOptionalFile, restClient } from './app.js'
export type { GitHubApp, GitHubAppConfig, GitHubClient, Installation, Repository } from './app.js'
export { EXPORT_BRANCH_PREFIX, exportBranchName, exportSummary, openExportPr } from './export.js'
export type { ExportFile, ExportedResource, OpenedPr } from './export.js'
export {
  TreeTooLarge,
  blobText,
  blobsUnder,
  branchHead,
  commitTree,
  configPathOf,
  diffTrees,
  directoryProblem,
  docketLayout,
  entryAt,
  fileAt,
  isDocketDocument,
  isNotFound,
  mapLimited,
  normaliseDirectory,
  repoPath,
  repositorySettings,
} from './trees.js'
export type { DocketLayout, RepositorySettings, TreeDiff } from './trees.js'
export { PUSH_DEBOUNCE_MS, enqueueRepoJob, handleWebhook, receiveWebhook, verifySignature } from './webhooks.js'
export type { EnqueueInput, RepoJobKind, WebhookDelivery, WebhookResponse, WebhookResult } from './webhooks.js'
export {
  ConnectionError,
  branchProblem,
  connectionById,
  createConnection,
  disconnect,
  dropRoutes,
  lastJobs,
  latestExports,
  linkInstallation,
  orgInstallations,
  orgRoutes,
  pendingJobs,
  recentIngests,
  recordExport,
  recordIngest,
  routeOf,
  setExportEnabled,
  workspaceConnections,
} from './connections.js'
export type { IngestEvent, IngestedDocument, LinkedInstallation, RepoConnection, RepoExport, RepoRoute } from './connections.js'
