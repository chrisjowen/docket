// SPDX-License-Identifier: AGPL-3.0-only
import { newTenantId, type Tx } from '@docket/platform-tenancy'

import { enqueueRepoJob } from './webhooks.js'
import { directoryProblem, normaliseDirectory } from './trees.js'

/**
 * An org's GitHub installations and its workspaces' repo connections
 * (§14.1). Installations and routes are platform rows (a webhook names no
 * org); a connection's details live in the org's schema. Functions say which
 * transaction they need: `withPlatform`, or the org's `withTenant`.
 */

export class ConnectionError extends Error {
  override name = 'ConnectionError'
  constructor(
    readonly code: 'invalid' | 'conflict' | 'not-found' | 'forbidden',
    message: string,
  ) {
    super(message)
  }
}

export interface LinkedInstallation {
  installationId: number
  orgId: string
  accountLogin: string
  accountType: string
  linkedBy: string
  linkedAt: Date
  suspendedAt: Date | null
  deletedAt: Date | null
}

type InstallationRow = {
  installation_id: string
  org_id: string
  account_login: string
  account_type: string
  linked_by: string
  linked_at: Date
  suspended_at: Date | null
  deleted_at: Date | null
}

const toInstallation = (row: InstallationRow): LinkedInstallation => ({
  installationId: Number(row.installation_id),
  orgId: row.org_id,
  accountLogin: row.account_login,
  accountType: row.account_type,
  linkedBy: row.linked_by,
  linkedAt: row.linked_at,
  suspendedAt: row.suspended_at,
  deletedAt: row.deleted_at,
})

/**
 * Links an installation to an org (`withPlatform`). The caller has proved the
 * signed-in admin's GitHub account can see the installation. One org per
 * installation: an installation linked to another org is refused.
 */
export async function linkInstallation(
  tx: Tx,
  input: { installationId: number; orgId: string; accountLogin: string; accountType: string; linkedBy: string },
): Promise<LinkedInstallation> {
  const { rows } = await tx.query<InstallationRow>(
    `INSERT INTO platform.github_installations (installation_id, org_id, account_login, account_type, linked_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (installation_id) DO UPDATE
        SET account_login = excluded.account_login, account_type = excluded.account_type, deleted_at = NULL,
            suspended_at = NULL, linked_by = excluded.linked_by, linked_at = now()
      WHERE platform.github_installations.org_id = excluded.org_id
     RETURNING *`,
    [input.installationId, input.orgId, input.accountLogin, input.accountType, input.linkedBy],
  )
  if (!rows[0]) throw new ConnectionError('conflict', 'That GitHub installation is linked to another organisation.')
  return toInstallation(rows[0])
}

/** The org's linked installations, live ones first (`withPlatform`). */
export async function orgInstallations(tx: Tx, orgId: string): Promise<LinkedInstallation[]> {
  const { rows } = await tx.query<InstallationRow>(
    `SELECT * FROM platform.github_installations WHERE org_id = $1
      ORDER BY deleted_at IS NOT NULL, account_login`,
    [orgId],
  )
  return rows.map(toInstallation)
}

export interface RepoRoute {
  connectionId: string
  orgId: string
  installationId: number
  repoId: number
  repoFullName: string
  branch: string
  removedAt: Date | null
  /** Why the connection cannot sync now, or null. */
  blocked: string | null
}

type RouteRow = {
  connection_id: string
  org_id: string
  installation_id: string
  repo_id: string
  repo_full_name: string
  branch: string
  removed_at: Date | null
  deleted_at: Date | null
  suspended_at: Date | null
}

const toRoute = (row: RouteRow): RepoRoute => ({
  connectionId: row.connection_id,
  orgId: row.org_id,
  installationId: Number(row.installation_id),
  repoId: Number(row.repo_id),
  repoFullName: row.repo_full_name,
  branch: row.branch,
  removedAt: row.removed_at,
  blocked: row.deleted_at
    ? 'The GitHub App was uninstalled.'
    : row.suspended_at
      ? 'The GitHub App installation is suspended.'
      : row.removed_at
        ? 'The GitHub App no longer has access to this repo.'
        : null,
})

/** A connection's route, with the state of its installation (`withPlatform`). */
export async function routeOf(tx: Tx, connectionId: string): Promise<RepoRoute | null> {
  const { rows } = await tx.query<RouteRow>(
    `SELECT r.*, i.deleted_at, i.suspended_at FROM platform.repo_routes r
       JOIN platform.github_installations i ON i.installation_id = r.installation_id
      WHERE r.connection_id = $1`,
    [connectionId],
  )
  return rows[0] ? toRoute(rows[0]) : null
}

/** Every route of the org (`withPlatform`). */
export async function orgRoutes(tx: Tx, orgId: string): Promise<RepoRoute[]> {
  const { rows } = await tx.query<RouteRow>(
    `SELECT r.*, i.deleted_at, i.suspended_at FROM platform.repo_routes r
       JOIN platform.github_installations i ON i.installation_id = r.installation_id
      WHERE r.org_id = $1`,
    [orgId],
  )
  return rows.map(toRoute)
}

export interface RepoConnection {
  id: string
  workspaceId: string
  installationId: number
  repoId: number
  repoFullName: string
  branch: string
  /** The docket root in the repo, without a trailing slash. */
  path: string
  exportEnabled: boolean
  lastSyncSha: string | null
  lastSyncAt: Date | null
  lastSyncError: string | null
  /** Repo path -> blob SHA at the last sync. */
  tree: Record<string, string>
  createdBy: string
  createdAt: Date
}

type ConnectionRow = {
  id: string
  workspace_id: string
  installation_id: string
  repo_id: string
  repo_full_name: string
  branch: string
  path: string
  export_enabled: boolean
  last_sync_sha: string | null
  last_sync_at: Date | null
  last_sync_error: string | null
  tree: Record<string, string>
  created_by: string
  created_at: Date
}

const toConnection = (row: ConnectionRow): RepoConnection => ({
  id: row.id,
  workspaceId: row.workspace_id,
  installationId: Number(row.installation_id),
  repoId: Number(row.repo_id),
  repoFullName: row.repo_full_name,
  branch: row.branch,
  path: row.path,
  exportEnabled: row.export_enabled,
  lastSyncSha: row.last_sync_sha,
  lastSyncAt: row.last_sync_at,
  lastSyncError: row.last_sync_error,
  tree: row.tree,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

/** A branch name GitHub would accept, roughly: no spaces, `..`, `~^:?*[\`, or leading `-` or `/`. */
export function branchProblem(branch: string): string | null {
  if (!branch || branch.length > 200) return 'Name a branch of 1-200 characters.'
  // eslint-disable-next-line no-control-regex
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]|\.\.|@\{|^[-/]|\/$|\.lock$|^@$/.test(branch)) return 'That is not a branch name GitHub allows.'
  return null
}

/**
 * Connects a repo to a workspace: its route and its first (full) sync are
 * queued in the platform schema, then `enterWorkspace` switches the
 * transaction to the org (`enterTenant`) and names the workspace, and the
 * connection is recorded there. The live documents of a disconnected
 * connection to the same repo, branch and path move to the new one, as one
 * ingest event. Call inside `withPlatform`.
 */
export async function createConnection(
  tx: Tx,
  input: {
    orgId: string
    installationId: number
    repo: { id: number; fullName: string }
    branch: string
    path: string
    createdBy: string
    requestId: string
    enterWorkspace: (tx: Tx) => Promise<string>
  },
): Promise<RepoConnection> {
  const branchIssue = branchProblem(input.branch)
  if (branchIssue) throw new ConnectionError('invalid', branchIssue)
  const pathIssue = directoryProblem(input.path)
  if (pathIssue) throw new ConnectionError('invalid', pathIssue)
  const path = normaliseDirectory(input.path)
  const installation = await tx.query(
    'SELECT 1 FROM platform.github_installations WHERE installation_id = $1 AND org_id = $2 AND deleted_at IS NULL',
    [input.installationId, input.orgId],
  )
  if (!installation.rowCount) throw new ConnectionError('not-found', 'That GitHub installation is not linked to this organisation.')
  const id = newTenantId()
  await tx.query(
    `INSERT INTO platform.repo_routes (connection_id, org_id, installation_id, repo_id, repo_full_name, branch)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.orgId, input.installationId, input.repo.id, input.repo.fullName, input.branch],
  )
  await enqueueRepoJob(tx, { orgId: input.orgId, connectionId: id, kind: 'sync', full: true, requestedBy: input.createdBy })
  const workspaceId = await input.enterWorkspace(tx)
  const taken = await tx.query(
    `SELECT 1 FROM repo_connections WHERE workspace_id = $1 AND repo_id = $2 AND branch = $3 AND path = $4 AND disconnected_at IS NULL`,
    [workspaceId, input.repo.id, input.branch, path],
  )
  if (taken.rowCount) throw new ConnectionError('conflict', `${input.repo.fullName}@${input.branch} ${path}/ is already connected to this workspace.`)
  const { rows } = await tx.query<ConnectionRow>(
    `INSERT INTO repo_connections (id, workspace_id, installation_id, repo_id, repo_full_name, branch, path, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, workspaceId, input.installationId, input.repo.id, input.repo.fullName, input.branch, path, input.createdBy],
  )
  const adopted = await tx.query<{ path: string; resource_id: string }>(
    `UPDATE documents d SET origin_ref = $1 || ':' || d.path
       FROM repo_connections c
      WHERE c.workspace_id = $2 AND c.repo_id = $3 AND c.branch = $4 AND c.path = $5 AND c.disconnected_at IS NOT NULL
        AND d.workspace_id = $2 AND d.origin = 'repo' AND d.retired_at IS NULL AND d.origin_ref = c.id || ':' || d.path
      RETURNING d.path, d.resource_id`,
    [id, workspaceId, input.repo.id, input.branch, path],
  )
  if (adopted.rowCount) {
    await recordIngest(tx, {
      workspaceId,
      channel: 'repo',
      actor: input.createdBy,
      connectionId: id,
      repository: input.repo.fullName,
      commit: null,
      documents: adopted.rows.map((row) => ({ path: row.path, resourceId: row.resource_id, change: 'adopted' as const })),
      notices: [`Took over ${adopted.rowCount} document(s) from an earlier connection to ${input.repo.fullName}@${input.branch} ${path}/.`],
      ontologyDraftId: null,
      outcome: 'ok',
      requestId: input.requestId,
    })
  }
  return toConnection(rows[0] as ConnectionRow)
}

/** A live connection of the org (`withTenant`), optionally locked for the rest of the transaction. */
export async function connectionById(
  tx: Tx,
  connectionId: string,
  options: { forUpdate?: boolean } = {},
): Promise<RepoConnection | null> {
  const { rows } = await tx.query<ConnectionRow>(
    `SELECT * FROM repo_connections WHERE id = $1 AND disconnected_at IS NULL
      AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.deleted_at IS NULL)${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [connectionId],
  )
  return rows[0] ? toConnection(rows[0]) : null
}

/** The workspace's live connections (`withTenant`). */
export async function workspaceConnections(tx: Tx, workspaceId: string): Promise<RepoConnection[]> {
  const { rows } = await tx.query<ConnectionRow>(
    `SELECT * FROM repo_connections WHERE workspace_id = $1 AND disconnected_at IS NULL ORDER BY repo_full_name, branch, path`,
    [workspaceId],
  )
  return rows.map(toConnection)
}

/** Turns "Export cloud knowledge" on or off for a connection (`withTenant`). */
export async function setExportEnabled(tx: Tx, connectionId: string, enabled: boolean): Promise<RepoConnection> {
  const { rows } = await tx.query<ConnectionRow>(
    'UPDATE repo_connections SET export_enabled = $2 WHERE id = $1 AND disconnected_at IS NULL RETURNING *',
    [connectionId, enabled],
  )
  if (!rows[0]) throw new ConnectionError('not-found', 'No such connection.')
  return toConnection(rows[0])
}

/**
 * Disconnects a repo: its route and queued jobs go, so pushes stop; the
 * documents it synced stay until someone retires them. Call inside
 * `withPlatform`; `enterWorkspace` switches to the org (`enterTenant`) and
 * may refuse a connection that is not the caller's.
 */
export async function disconnect(
  tx: Tx,
  input: { orgId: string; connectionId: string; enterWorkspace: (tx: Tx) => Promise<unknown> },
): Promise<RepoConnection> {
  await tx.query('DELETE FROM platform.repo_routes WHERE connection_id = $1 AND org_id = $2', [input.connectionId, input.orgId])
  await input.enterWorkspace(tx)
  const { rows } = await tx.query<ConnectionRow>(
    'UPDATE repo_connections SET disconnected_at = now() WHERE id = $1 AND disconnected_at IS NULL RETURNING *',
    [input.connectionId],
  )
  if (!rows[0]) throw new ConnectionError('not-found', 'No such connection.')
  return toConnection(rows[0])
}

/** Drops the webhook routes of connections that went with their workspace, so pushes to those repos route nowhere. */
export async function dropRoutes(tx: Tx, input: { orgId: string; connectionIds: readonly string[] }): Promise<void> {
  if (input.connectionIds.length === 0) return
  await tx.query('DELETE FROM platform.repo_routes WHERE org_id = $1 AND connection_id = ANY($2)', [input.orgId, [...input.connectionIds]])
}

/** One document an ingest event touched. */
export interface IngestedDocument {
  path: string
  resourceId: string
  change: 'upserted' | 'retired' | 'exported' | 'adopted'
}

/** A change to a workspace's knowledge as the activity log shows it (§14.2). */
export interface IngestEvent {
  id: string
  workspaceId: string
  channel: 'repo' | 'mcp' | 'ui' | 'cli' | 'ontology'
  actor: string
  connectionId: string | null
  repository: string | null
  commit: string | null
  documents: IngestedDocument[]
  notices: string[]
  ontologyDraftId: string | null
  outcome: 'ok' | 'partial' | 'error'
  requestId: string
  createdAt: Date
}

type IngestRow = {
  id: string
  workspace_id: string
  channel: IngestEvent['channel']
  actor: string
  connection_id: string | null
  repository: string | null
  commit_sha: string | null
  documents: IngestedDocument[]
  notices: string[]
  ontology_draft_id: string | null
  outcome: IngestEvent['outcome']
  request_id: string
  created_at: Date
}

const toIngest = (row: IngestRow): IngestEvent => ({
  id: row.id,
  workspaceId: row.workspace_id,
  channel: row.channel,
  actor: row.actor,
  connectionId: row.connection_id,
  repository: row.repository,
  commit: row.commit_sha,
  documents: row.documents,
  notices: row.notices,
  ontologyDraftId: row.ontology_draft_id,
  outcome: row.outcome,
  requestId: row.request_id,
  createdAt: row.created_at,
})

/** Records an ingest event (`withTenant`), in the transaction that made the change. */
export async function recordIngest(
  tx: Tx,
  input: Omit<IngestEvent, 'id' | 'createdAt'>,
): Promise<IngestEvent> {
  const { rows } = await tx.query<IngestRow>(
    `INSERT INTO ingest_events (workspace_id, channel, actor, connection_id, repository, commit_sha, documents, notices,
                                ontology_draft_id, outcome, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      input.workspaceId,
      input.channel,
      input.actor,
      input.connectionId,
      input.repository,
      input.commit,
      JSON.stringify(input.documents),
      input.notices,
      input.ontologyDraftId,
      input.outcome,
      input.requestId,
    ],
  )
  return toIngest(rows[0] as IngestRow)
}

/** The newest ingest events of a workspace, or of one connection (`withTenant`). */
export async function recentIngests(
  tx: Tx,
  query: { workspaceId: string; connectionId?: string; limit?: number },
): Promise<IngestEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 200)
  const { rows } = query.connectionId
    ? await tx.query<IngestRow>(
        'SELECT * FROM ingest_events WHERE workspace_id = $1 AND connection_id = $2 ORDER BY created_at DESC LIMIT $3',
        [query.workspaceId, query.connectionId, limit],
      )
    : await tx.query<IngestRow>('SELECT * FROM ingest_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2', [
        query.workspaceId,
        limit,
      ])
  return rows.map(toIngest)
}

export interface RepoExport {
  id: string
  connectionId: string
  branch: string
  prNumber: number
  prUrl: string
  documents: { documentId: string; path: string; resourceId: string; hash: string }[]
  ontologyNumber: number | null
  createdBy: string
  createdAt: Date
}

type ExportRow = {
  id: string
  connection_id: string
  branch: string
  pr_number: number
  pr_url: string
  documents: RepoExport['documents']
  ontology_number: number | null
  created_by: string
  created_at: Date
}

const toExport = (row: ExportRow): RepoExport => ({
  id: row.id,
  connectionId: row.connection_id,
  branch: row.branch,
  prNumber: row.pr_number,
  prUrl: row.pr_url,
  documents: row.documents,
  ontologyNumber: row.ontology_number,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

/** Records an export PR (`withTenant`). */
export async function recordExport(tx: Tx, input: Omit<RepoExport, 'id' | 'createdAt'>): Promise<RepoExport> {
  const { rows } = await tx.query<ExportRow>(
    `INSERT INTO repo_exports (connection_id, branch, pr_number, pr_url, documents, ontology_number, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.connectionId, input.branch, input.prNumber, input.prUrl, JSON.stringify(input.documents), input.ontologyNumber, input.createdBy],
  )
  return toExport(rows[0] as ExportRow)
}

/** Each connection's newest export PR (`withTenant`). */
export async function latestExports(tx: Tx, connectionIds: readonly string[]): Promise<Map<string, RepoExport>> {
  if (!connectionIds.length) return new Map()
  const { rows } = await tx.query<ExportRow>(
    `SELECT DISTINCT ON (connection_id) * FROM repo_exports WHERE connection_id = ANY($1)
      ORDER BY connection_id, created_at DESC`,
    [connectionIds],
  )
  return new Map(rows.map((row) => [row.connection_id, toExport(row)]))
}

/** The repo jobs waiting or running for the org's connections (`withPlatform`). */
export async function pendingJobs(tx: Tx, orgId: string): Promise<{ connectionId: string; kind: 'sync' | 'export'; running: boolean }[]> {
  const { rows } = await tx.query<{ connection_id: string; kind: 'sync' | 'export'; running: boolean }>(
    `SELECT connection_id, kind, started_at IS NOT NULL AS running FROM platform.repo_jobs
      WHERE org_id = $1 AND finished_at IS NULL ORDER BY id`,
    [orgId],
  )
  return rows.map((row) => ({ connectionId: row.connection_id, kind: row.kind, running: row.running }))
}

/** The newest finished job of each kind per connection, for showing a failed export or sync (`withPlatform`). */
export async function lastJobs(
  tx: Tx,
  orgId: string,
): Promise<{ connectionId: string; kind: 'sync' | 'export'; outcome: string | null; error: string | null; finishedAt: Date }[]> {
  const { rows } = await tx.query<{ connection_id: string; kind: 'sync' | 'export'; outcome: string | null; error: string | null; finished_at: Date }>(
    `SELECT DISTINCT ON (connection_id, kind) connection_id, kind, outcome, error, finished_at FROM platform.repo_jobs
      WHERE org_id = $1 AND finished_at IS NOT NULL ORDER BY connection_id, kind, finished_at DESC`,
    [orgId],
  )
  return rows.map((row) => ({ connectionId: row.connection_id, kind: row.kind, outcome: row.outcome, error: row.error, finishedAt: row.finished_at }))
}
