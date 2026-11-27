// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit } from '@docket/platform-audit'
import {
  DocumentError,
  attestationsChanged,
  checkDocument,
  enqueue,
  hashContent,
  putDocument,
  recordRepositoryAttributes,
  type Keyring,
  type StoreContext,
} from '@docket/platform-canonical-store'
import {
  blobText,
  blobsUnder,
  branchHead,
  commitTree,
  configPathOf,
  connectionById,
  diffTrees,
  docketLayout,
  fileAt,
  isDocketDocument,
  mapLimited,
  recordIngest,
  routeOf,
  type GitHubApp,
  type IngestEvent,
  type IngestedDocument,
  type RepoConnection,
  type RepoRoute,
  repositorySettings,
} from '@docket/platform-github'
import { OntologyInvalid, checkDraft, createDraft, headOf, importYaml } from '@docket/platform-ontology-service'
import type { TenantRouter, Tx } from '@docket/platform-tenancy'

/**
 * Repo sync (§14.1): a connection's docket files at a commit, read with the
 * Git Trees API and diffed by blob SHA against the last sync, become
 * `origin=repo` documents in one transaction, recorded as one ingest event
 * with the commit. Files that are gone are retired; a differing
 * `entities.yaml` becomes an ontology draft, never a publish.
 */

export const SYNC_ACTOR = 'system:repo-sync'

export class RepoSyncError extends Error {
  override name = 'RepoSyncError'
  constructor(
    readonly code: 'not-found' | 'blocked',
    message: string,
  ) {
    super(message)
  }
}

export interface RepoSyncDeps {
  router: TenantRouter
  keyring: Keyring
  github: GitHubApp
}

/** `origin_ref` of a repo document (§6.1): the connection and the repo path. */
export const originRef = (connectionId: string, path: string) => `${connectionId}:${path}`

/** What a sync read from GitHub, before it touches Postgres. */
interface Snapshot {
  commit: string
  /** Docket documents under the layout, by repo path, with their blob SHA. */
  current: Map<string, string>
  /** The texts of the documents whose blob changed. */
  fetched: { path: string; raw: string }[]
  ontology: { path: string; sha: string; text: string | null } | null
  /** The repo's `.docket.yaml`, if it has one. */
  config: { path: string; sha: string } | null
  notices: string[]
}

async function readRepo(
  deps: RepoSyncDeps,
  route: RepoRoute,
  connection: RepoConnection,
  options: { commit: string; full: boolean },
): Promise<Snapshot> {
  const client = deps.github.client(route.installationId)
  const repo = route.repoFullName
  const commit = options.commit
  const rootTree = await commitTree(client, repo, commit)
  const configPath = configPathOf(connection.path)
  const config = await fileAt(client, repo, rootTree, configPath)
  const layout = docketLayout(connection.path, config?.text ?? null)
  const blobs = await blobsUnder(client, repo, rootTree, layout.root)
  const current = new Map([...blobs].filter(([path]) => isDocketDocument(layout, path)))
  // What .docket.yaml says is news only when it changed, not on every push.
  const configChanged = options.full || connection.tree[configPath] !== config?.sha
  const notices = configChanged ? [...layout.notices] : []
  if (!blobs.size) notices.push(`${repo}@${route.branch} has no ${layout.root}/ directory at ${commit.slice(0, 7)}.`)

  const previous = options.full ? {} : connection.tree
  const { changed } = diffTrees(previous, current)
  const fetched = await mapLimited(changed, 8, async (path) => ({
    path,
    raw: await blobText(client, repo, current.get(path) as string),
  }))
  const ontologySha = blobs.get(layout.ontologyPath)
  const ontologyChanged = ontologySha !== undefined && (options.full || connection.tree[layout.ontologyPath] !== ontologySha)
  const ontology = ontologySha
    ? { path: layout.ontologyPath, sha: ontologySha, text: ontologyChanged ? await blobText(client, repo, ontologySha) : null }
    : null
  return { commit, current, fetched, ontology, config: config ? { path: configPath, sha: config.sha } : null, notices }
}

type LiveRow = { id: string; origin: string; origin_ref: string | null; resource_id: string; hash: string }

/**
 * Proposes the repo's `entities.yaml` as a draft when it differs from the
 * published head (§14.1), with the change check stored on it. Never
 * publishes: the cloud is the source of truth (G4).
 */
async function proposeOntology(
  ctx: StoreContext,
  input: { workspaceId: string; text: string; repo: string; commit: string },
): Promise<{ draftId: string | null; created: boolean; notice: string | null }> {
  const imported = importYaml(input.text)
  const head = await headOf(ctx.tx, input.workspaceId)
  if (head && imported.yaml === head.yaml) return { draftId: null, created: false, notice: null }
  const source = `repo:${input.repo}@${input.commit.slice(0, 7)}`
  const open = await ctx.tx.query<{ id: string }>(
    `SELECT id FROM ontology_versions WHERE workspace_id = $1 AND status = 'draft' AND yaml_hash = $2 AND source LIKE 'repo:%'`,
    [input.workspaceId, hashContent(imported.yaml)],
  )
  if (open.rows[0]) return { draftId: open.rows[0].id, created: false, notice: `entities.yaml differs from v${head?.number ?? 0}; it is already proposed as a draft.` }
  try {
    const draft = await createDraft(ctx.tx, input.workspaceId, {
      yaml: imported.yaml,
      source,
      author: SYNC_ACTOR,
      message: `Proposed from ${input.repo}@${input.commit.slice(0, 7)}`,
    })
    const check = await checkDraft(ctx, input.workspaceId, draft.yaml)
    await ctx.tx.query('UPDATE ontology_versions SET check_result = $2 WHERE id = $1', [draft.id, JSON.stringify(check)])
    return {
      draftId: draft.id,
      created: true,
      notice: `entities.yaml differs from v${head?.number ?? 0}: proposed as a draft (${check.classification}) for an admin to review. It is not published.`,
    }
  } catch (error) {
    if (error instanceof OntologyInvalid) {
      return { draftId: null, created: false, notice: `entities.yaml is not a valid ontology, so nothing was proposed: ${error.diagnostics.map((d) => d.message).join(' ')}` }
    }
    throw error
  }
}

/** Applies a snapshot in the org's transaction and records it as one ingest event. */
async function apply(
  ctx: StoreContext,
  input: { route: RepoRoute; connection: RepoConnection; snapshot: Snapshot; full: boolean; requestId: string; startedAt: number },
): Promise<IngestEvent> {
  const { tx } = ctx
  const { route, snapshot } = input
  const connection = await connectionById(tx, input.connection.id, { forUpdate: true })
  if (!connection) throw new RepoSyncError('not-found', 'The connection was disconnected.')
  const workspaceId = connection.workspaceId
  const notices = [...snapshot.notices]
  const touched: IngestedDocument[] = []
  // The tree the next sync diffs against: everything read, less what was held back to try again.
  const tree: Record<string, string> = Object.fromEntries(snapshot.current)
  let outcome: IngestEvent['outcome'] = 'ok'
  let workspaceFull = false

  for (const file of snapshot.fetched) {
    const ref = originRef(connection.id, file.path)
    let parsed
    try {
      parsed = checkDocument(file.path, file.raw)
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error
      notices.push(`${file.path} was not synced: ${error.message.replace(`${file.path}: `, '')}`)
      outcome = 'partial'
      continue
    }
    if (workspaceFull) {
      notices.push(`${file.path} was not synced: the workspace is full.`)
      delete tree[file.path]
      continue
    }
    const { rows } = await tx.query<LiveRow>(
      `SELECT id, origin, origin_ref, resource_id, hash FROM documents WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL FOR UPDATE`,
      [workspaceId, file.path],
    )
    const live = rows[0]
    if (live && !(live.origin === 'repo' && live.origin_ref === ref)) {
      if (live.origin === 'cloud' && live.resource_id === parsed.id && live.hash === hashContent(file.raw)) {
        // The export PR merged: the cloud copy steps aside for the repo's (§14.3).
        await tx.query('UPDATE documents SET exported_to = $2, retired_at = now() WHERE id = $1', [live.id, ref])
        touched.push({ path: file.path, resourceId: live.resource_id, change: 'exported' })
      } else {
        const holder = live.origin === 'repo' ? `another repo connection's ${live.resource_id}` : `the ${live.origin} document ${live.resource_id}`
        notices.push(`${file.path} was not synced: the workspace already holds ${holder} at that path.`)
        delete tree[file.path]
        outcome = 'partial'
        continue
      }
    }
    try {
      const { document, changed } = await putDocument(ctx, {
        workspaceId,
        path: file.path,
        raw: file.raw,
        origin: 'repo',
        originRef: ref,
        actor: SYNC_ACTOR,
      })
      if (changed) touched.push({ path: file.path, resourceId: document.resourceId, change: 'upserted' })
    } catch (error) {
      if (!(error instanceof DocumentError) || error.code !== 'limit') throw error
      notices.push(`${file.path} was not synced: ${error.message}`)
      delete tree[file.path]
      outcome = 'partial'
      workspaceFull = true
    }
  }

  // Every document this connection holds that the commit no longer has: a removed directory retires them all at once.
  const gone = await tx.query<{ path: string; resource_id: string }>(
    `UPDATE documents SET retired_at = now()
      WHERE workspace_id = $1 AND origin = 'repo' AND origin_ref = $2 || ':' || path AND retired_at IS NULL
        AND NOT (path = ANY($3))
      RETURNING path, resource_id`,
    [workspaceId, connection.id, [...snapshot.current.keys()]],
  )
  for (const row of gone.rows) touched.push({ path: row.path, resourceId: row.resource_id, change: 'retired' })

  // Cloud documents an export carried into the repo, now synced back at any path (§14.3).
  const exported = await tx.query<{ path: string; resource_id: string }>(
    `UPDATE documents c SET exported_to = r.origin_ref, retired_at = now()
       FROM documents r
      WHERE c.workspace_id = $1 AND c.origin = 'cloud' AND c.retired_at IS NULL
        AND r.workspace_id = $1 AND r.origin = 'repo' AND r.retired_at IS NULL AND r.origin_ref = $2 || ':' || r.path
        AND r.resource_id = c.resource_id AND r.hash = c.hash
      RETURNING c.path, c.resource_id`,
    [workspaceId, connection.id],
  )
  for (const row of exported.rows) touched.push({ path: row.path, resourceId: row.resource_id, change: 'exported' })
  if (gone.rowCount || exported.rowCount) await enqueue(tx, workspaceId, 'documents')

  if (snapshot.config) tree[snapshot.config.path] = snapshot.config.sha
  let proposed: { draftId: string | null; created: boolean } = { draftId: null, created: false }
  if (snapshot.ontology) {
    tree[snapshot.ontology.path] = snapshot.ontology.sha
    if (snapshot.ontology.text !== null) {
      const result = await proposeOntology(ctx, { workspaceId, text: snapshot.ontology.text, repo: route.repoFullName, commit: snapshot.commit })
      proposed = { draftId: result.draftId, created: result.created }
      if (result.notice) notices.push(result.notice)
    }
  }

  await tx.query(
    `UPDATE repo_connections SET tree = $2, last_sync_sha = $3, last_sync_at = now(), last_sync_error = NULL WHERE id = $1`,
    [connection.id, JSON.stringify(tree), snapshot.commit],
  )
  const event = await recordIngest(tx, {
    workspaceId,
    channel: 'repo',
    actor: SYNC_ACTOR,
    connectionId: connection.id,
    repository: route.repoFullName,
    commit: snapshot.commit,
    documents: touched,
    notices,
    ontologyDraftId: proposed.draftId,
    outcome,
    requestId: input.requestId,
  })
  const auditFields = {
    orgId: ctx.keys.orgId,
    workspaceId,
    actor: SYNC_ACTOR,
    outcome: 'ok',
    latencyMs: performance.now() - input.startedAt,
    requestId: input.requestId,
  } as const
  if (proposed.created && proposed.draftId) {
    // What tells the workspace's admins a repo proposed an ontology change: the event and the open draft (§14.1).
    await audit(tx, { ...auditFields, action: 'ontology.proposed', target: [proposed.draftId], args: { repository: route.repoFullName, commit: snapshot.commit } })
  }
  await audit(tx, {
    ...auditFields,
    action: 'repo.sync',
    target: [...new Set(touched.map((document) => document.resourceId))],
    args: { connection: connection.id, commit: snapshot.commit, full: input.full },
  })
  return event
}

async function recordFailure(router: TenantRouter, orgId: string, connectionId: string, message: string): Promise<void> {
  await router
    .withTenant(orgId, (tx: Tx) =>
      tx.query('UPDATE repo_connections SET last_sync_error = $2 WHERE id = $1', [connectionId, message.slice(0, 500)]),
    )
    .catch(() => undefined)
}

export interface RepoSync {
  /**
   * Syncs a connection at its branch head, so a sync never goes back to an
   * older commit. `full` reads every file, not only blobs that changed since
   * the last sync: the initial import and "Resync now". Resolves to null when
   * the head is the commit the last sync read: no ingest event is recorded,
   * and an error a failed attempt left on the connection is cleared.
   */
  syncConnection(connectionId: string, options?: { full?: boolean; requestId?: string }): Promise<IngestEvent | null>
}

export function repoSync(deps: RepoSyncDeps): RepoSync {
  return {
    async syncConnection(connectionId, options = {}) {
      const startedAt = performance.now()
      const requestId = options.requestId ?? randomUUID()
      const route = await deps.router.withPlatform((tx) => routeOf(tx, connectionId))
      if (!route) throw new RepoSyncError('not-found', `no connection ${connectionId}`)
      if (route.blocked) {
        await recordFailure(deps.router, route.orgId, connectionId, route.blocked)
        throw new RepoSyncError('blocked', route.blocked)
      }
      const connection = await deps.router.withTenant(route.orgId, (tx) => connectionById(tx, connectionId))
      if (!connection) throw new RepoSyncError('not-found', `no connection ${connectionId}`)
      const full = options.full === true || connection.lastSyncSha === null
      let snapshot: Snapshot | null
      try {
        const client = deps.github.client(route.installationId)
        const commit = await branchHead(client, route.repoFullName, route.branch)
        snapshot = !full && commit === connection.lastSyncSha ? null : await readRepo(deps, route, connection, { commit, full })
        // What GitHub attests about the repository as a source - its visibility, a protected branch - read at every sync.
        const settings = await repositorySettings(client, route.repoFullName, route.branch)
        const keys = await deps.keyring.forOrg(route.orgId)
        await deps.router.withTenant(route.orgId, async (tx) => {
          if (await recordRepositoryAttributes({ tx }, connectionId, settings)) await attestationsChanged({ tx, keys })
        })
      } catch (error) {
        await recordFailure(deps.router, route.orgId, connectionId, error instanceof Error ? error.message : String(error))
        throw error
      }
      if (!snapshot) {
        await deps.router.withTenant(route.orgId, (tx) =>
          tx.query('UPDATE repo_connections SET last_sync_error = NULL WHERE id = $1 AND last_sync_sha = $2', [connectionId, connection.lastSyncSha]),
        )
        return null
      }
      const keys = await deps.keyring.forOrg(route.orgId)
      return deps.router.withTenant(route.orgId, (tx) =>
        apply({ tx, keys }, { route, connection, snapshot, full, requestId, startedAt }),
      )
    },
  }
}
