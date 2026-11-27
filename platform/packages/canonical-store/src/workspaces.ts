// SPDX-License-Identifier: AGPL-3.0-only
import { LIMITS, SLUG, newTenantId, type Role, type Tx } from '@docket/platform-tenancy'

import { purgeWorkspaceFromChats } from './chats.js'
import type { StoreContext } from './documents.js'
import type { SyncTrigger } from './sync-runs.js'

/**
 * Workspaces (§4): one docket each, inside an org's schema. Every function
 * runs inside the org's `withTenant` transaction.
 */
export interface Workspace {
  id: string
  slug: string
  name: string
  createdBy: string
  createdAt: Date
  /** The roles whose `ontology:write` credentials may publish the ontology over MCP; empty keeps MCP to proposals. */
  ontologyMcpRoles: OntologyMcpRole[]
}

/** The roles the owner can let change the ontology directly over MCP: viewers only ever read. */
export const ONTOLOGY_MCP_ROLES = ['owner', 'admin', 'editor'] as const satisfies readonly Role[]
export type OntologyMcpRole = (typeof ONTOLOGY_MCP_ROLES)[number]

export class WorkspaceError extends Error {
  override name = 'WorkspaceError'
  constructor(
    readonly code: 'invalid' | 'conflict' | 'limit' | 'not-found',
    message: string,
  ) {
    super(message)
  }
}

/** A workspace's address inside its org (`/o/{org}/w/{slug}`): the org slug's shape, with `new` kept for the create page. */
export function workspaceSlugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) return 'Use 2-40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.'
  if (slug.includes('--')) return 'Use single hyphens only.'
  if (slug === 'new') return 'That name is reserved.'
  return null
}

type WorkspaceRow = { id: string; slug: string; name: string; created_by: string; created_at: Date; ontology_mcp_roles: string[] }

const isOntologyMcpRole = (value: unknown): value is OntologyMcpRole => (ONTOLOGY_MCP_ROLES as readonly unknown[]).includes(value)

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at,
  ontologyMcpRoles: row.ontology_mcp_roles.filter(isOntologyMcpRole),
})

export async function listWorkspaces(tx: Tx): Promise<Workspace[]> {
  const { rows } = await tx.query<WorkspaceRow>('SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY name, slug')
  return rows.map(toWorkspace)
}

export async function workspaceBySlug(tx: Tx, slug: string): Promise<Workspace | null> {
  const { rows } = await tx.query<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1 AND deleted_at IS NULL', [slug])
  return rows[0] ? toWorkspace(rows[0]) : null
}

export async function workspaceById(tx: Tx, id: string): Promise<Workspace | null> {
  const { rows } = await tx.query<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [id])
  return rows[0] ? toWorkspace(rows[0]) : null
}

/**
 * The workspaces the beta's limit counts: the ones members created. The org admin API's databases carry an
 * `owner_ref` and are held to the org's own limit instead, so they leave the members' allowance alone.
 */
export async function countMemberWorkspaces(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ count: string }>('SELECT count(*) FROM workspaces WHERE owner_ref IS NULL')
  return Number(rows[0]?.count ?? 0)
}

/**
 * Records a workspace. Its first ontology version is published by the ontology service, in the same transaction.
 * `maxWorkspaces` replaces the beta's limit for the org admin API, which holds the org to its own (docs/org-api.md),
 * counting every workspace; otherwise members' workspaces are held to the beta's (`countMemberWorkspaces`).
 */
export async function insertWorkspace(
  tx: Tx,
  input: { name: string; slug: string; createdBy: string; id?: string; maxWorkspaces?: number },
): Promise<Workspace> {
  const name = input.name.trim()
  if (!name || name.length > 80) throw new WorkspaceError('invalid', 'Name the workspace in 1-80 characters.')
  const problem = workspaceSlugProblem(input.slug)
  if (problem) throw new WorkspaceError('invalid', problem)
  // Serialised per org, so the workspace limit holds under concurrent creates.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:workspace-create:' || current_schema()))")
  const count =
    input.maxWorkspaces === undefined
      ? await countMemberWorkspaces(tx)
      : Number((await tx.query<{ count: string }>('SELECT count(*) FROM workspaces')).rows[0]?.count ?? 0)
  if (count >= (input.maxWorkspaces ?? LIMITS.workspacesPerOrg)) {
    throw new WorkspaceError(
      'limit',
      input.maxWorkspaces === undefined
        ? `An organisation holds at most ${LIMITS.workspacesPerOrg} workspaces in the beta.`
        : `This organisation holds at most ${input.maxWorkspaces} databases.`,
    )
  }
  const taken = await tx.query('SELECT 1 FROM workspaces WHERE slug = $1', [input.slug])
  if (taken.rowCount) throw new WorkspaceError('conflict', 'A workspace already has that address.')
  const { rows } = await tx.query<WorkspaceRow>(
    'INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [input.id ?? newTenantId(), input.slug, name, input.createdBy],
  )
  return toWorkspace(rows[0] as WorkspaceRow)
}

/**
 * Deletes a workspace and everything the org's schema holds for it (§4): its
 * documents with every revision, its ontology, manifests, outbox, projection
 * status, repo connections and activity log go with the row, and what it
 * contributed to members' saved chats is purged (`purgeWorkspaceFromChats`). The org's audit
 * log keeps its events. The deletion is recorded for the worker, which clears
 * the workspace's scope from the projections. Returns the repo connections
 * that went, whose webhook routes the platform still holds.
 */
export async function deleteWorkspace(
  ctx: StoreContext,
  input: { workspaceId: string; deletedBy: string },
): Promise<{ workspace: Workspace; connections: string[] }> {
  const { tx } = ctx
  const { rows } = await tx.query<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [input.workspaceId])
  const row = rows[0]
  if (!row) throw new WorkspaceError('not-found', 'No such workspace.')
  const { rows: connections } = await tx.query<{ id: string }>('SELECT id FROM repo_connections WHERE workspace_id = $1', [input.workspaceId])
  await tx.query('INSERT INTO workspace_deletions (workspace_id, slug, name, deleted_by) VALUES ($1, $2, $3, $4)', [
    row.id,
    row.slug,
    row.name,
    input.deletedBy,
  ])
  // Saved chats quote the workspace's documents: what it contributed goes with it.
  await purgeWorkspaceFromChats(ctx, { id: row.id, slug: row.slug })
  await tx.query('DELETE FROM workspaces WHERE id = $1', [input.workspaceId])
  return { workspace: toWorkspace(row), connections: connections.map((connection) => connection.id) }
}

/** A deleted workspace whose projections the worker has still to clear. */
export interface PendingDeletion {
  workspaceId: string
  slug: string
  deletedAt: Date
  failures: number
}

/** The org's deletions still to purge from the projections, oldest first, leaving out any backing off after a failure. */
export async function pendingDeletions(tx: Tx, now: Date): Promise<PendingDeletion[]> {
  const { rows } = await tx.query<{ workspace_id: string; slug: string; deleted_at: Date; failures: number }>(
    `SELECT workspace_id, slug, deleted_at, failures FROM workspace_deletions
      WHERE purged_at IS NULL AND (retry_at IS NULL OR retry_at <= $1) ORDER BY deleted_at`,
    [now],
  )
  return rows.map((row) => ({ workspaceId: row.workspace_id, slug: row.slug, deletedAt: row.deleted_at, failures: row.failures }))
}

/** Records how a purge went: done, or failed with the time to try again. */
export async function recordPurge(
  tx: Tx,
  workspaceId: string,
  outcome: { at: Date } | { at: Date; error: string; retryAt: Date },
): Promise<void> {
  if ('error' in outcome) {
    await tx.query(
      'UPDATE workspace_deletions SET failures = failures + 1, last_error = $2, retry_at = $3 WHERE workspace_id = $1',
      [workspaceId, outcome.error.slice(0, 2_000), outcome.retryAt],
    )
  } else {
    await tx.query(
      'UPDATE workspace_deletions SET purged_at = $2, last_error = NULL, retry_at = NULL WHERE workspace_id = $1',
      [workspaceId, outcome.at],
    )
  }
}

/**
 * The roles that may publish the workspace's ontology over MCP, read now.
 * A publish serialises with the setting by taking the head lock, then the
 * workspace row FOR UPDATE, before reading it.
 */
export async function ontologyMcpRoles(tx: Tx, workspaceId: string): Promise<OntologyMcpRole[]> {
  const { rows } = await tx.query<{ ontology_mcp_roles: string[] }>(
    'SELECT ontology_mcp_roles FROM workspaces WHERE id = $1 AND deleted_at IS NULL',
    [workspaceId],
  )
  return rows[0]?.ontology_mcp_roles.filter(isOntologyMcpRole) ?? []
}

/** Sets which roles may publish the ontology over MCP. The caller checks the actor is the org's owner. */
export async function setOntologyMcpRoles(tx: Tx, workspaceId: string, roles: readonly string[]): Promise<OntologyMcpRole[]> {
  const unknown = roles.filter((role) => !isOntologyMcpRole(role))
  if (unknown.length) throw new WorkspaceError('invalid', `Only ${ONTOLOGY_MCP_ROLES.join(', ')} can change the ontology over MCP.`)
  const chosen = ONTOLOGY_MCP_ROLES.filter((role) => roles.includes(role))
  const updated = await tx.query('UPDATE workspaces SET ontology_mcp_roles = $2 WHERE id = $1 AND deleted_at IS NULL', [workspaceId, chosen])
  if (!updated.rowCount) throw new WorkspaceError('not-found', 'No such workspace.')
  return chosen
}

/**
 * Queues reconciliation for the workspace (§6.2), in the transaction that
 * changed it. `rebuild` asks the worker to reset the workspace's projections
 * and replay everything into them; `recheck` asks for a pass now, which
 * projects only what the documents and the manifests say is missing.
 */
export async function enqueue(tx: Tx, workspaceId: string, kind: SyncTrigger): Promise<void> {
  await tx.query('INSERT INTO outbox (workspace_id, kind) VALUES ($1, $2)', [workspaceId, kind])
}
