// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { audit } from '@docket/platform-audit'
import { parseMemoryFile, readDocuments, workspaceById, type Keyring } from '@docket/platform-canonical-store'
import {
  branchHead,
  commitTree,
  configPathOf,
  connectionById,
  docketLayout,
  exportBranchName,
  exportSummary,
  fileAt,
  openExportPr,
  recordExport,
  routeOf,
  type DocketLayout,
  type ExportFile,
  type ExportedResource,
  type GitHubApp,
} from '@docket/platform-github'
import {
  describeMigration,
  exportYaml,
  headOf,
  importYaml,
  listPublished,
  rewriteDocument,
  type OntologyVersion,
} from '@docket/platform-ontology-service'
import type { TenantRouter, Tx } from '@docket/platform-tenancy'

/**
 * "Export cloud knowledge" (§14.3): every un-exported `origin=cloud` document
 * of the workspace, rendered as docket Markdown at its path, plus repo files an
 * ontology migration left for the repo to update and the published
 * `entities.yaml` when the repo's differs, as one commit on a new
 * `docket-cloud/export-<yyyymmdd-hhmm>` branch and one PR into the
 * connection's branch.
 */

export const EXPORT_ACTOR = 'system:repo-export'

export class ExportError extends Error {
  override name = 'ExportError'
  constructor(
    readonly code: 'not-found' | 'blocked' | 'disabled' | 'empty',
    message: string,
  ) {
    super(message)
  }
}

export interface ExportPrDeps {
  router: TenantRouter
  keyring: Keyring
  github: GitHubApp
  /** The public origin, so the PR links back to the workspace. */
  origin?: string
  now?: () => Date
}

/** Where a cloud document's path (`.docket/...`) lands in a repo whose docket root is `layout.root`. */
export function repoPathFor(layout: DocketLayout, cloudPath: string): string {
  return cloudPath.startsWith('.docket/') ? `${layout.root}/${cloudPath.slice('.docket/'.length)}` : cloudPath
}

/**
 * Repo documents of this connection that a published migration left for the
 * repo to update (a disposition of `update-in-repo`), rewritten as publishing
 * would have rewritten a cloud document. A file the migration no longer
 * changes is left out, so an export after the fix merged carries nothing.
 */
function migratedRepoFiles(
  versions: readonly OntologyVersion[],
  repoDocuments: readonly { path: string; resourceId: string; raw: string }[],
): { path: string; raw: string }[] {
  const out = new Map<string, string>()
  for (const version of [...versions].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
    const pending = new Set((version.dispositions ?? []).filter((d) => d.disposition === 'update-in-repo').map((d) => d.resourceId))
    if (!pending.size || !version.migration?.length) continue
    const migration = version.migration
    for (const document of repoDocuments) {
      if (!pending.has(document.resourceId)) continue
      const current = out.get(document.path) ?? document.raw
      const next = rewriteDocument(current, migration, (applied) => ({
        source: 'human',
        observedBy: version.publishedBy ?? 'publisher',
        note: `ontology v${version.number} migration: ${applied.map(describeMigration).join(', ')}`,
      }))
      if (next) out.set(document.path, next.raw)
    }
  }
  return [...out].map(([path, raw]) => ({ path, raw }))
}

async function actorNames(tx: Tx, actors: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(actors.filter((actor) => actor.startsWith('user:')).map((actor) => actor.slice(5)))]
  if (!ids.length) return new Map()
  const { rows } = await tx.query<{ id: string; login: string }>('SELECT id, login FROM platform.users WHERE id = ANY($1)', [ids])
  return new Map(rows.map((row) => [`user:${row.id}`, `@${row.login}`]))
}

export interface ExportPr {
  /** Opens the export PR for a connection with export enabled. Throws `ExportError('empty')` when nothing needs exporting. */
  exportConnection(connectionId: string, options?: { requestedBy?: string; requestId?: string }): Promise<{ prUrl: string; documents: number }>
}

export function exportPr(deps: ExportPrDeps): ExportPr {
  const now = deps.now ?? (() => new Date())
  return {
    async exportConnection(connectionId, options = {}) {
      const startedAt = performance.now()
      const requestId = options.requestId ?? randomUUID()
      const route = await deps.router.withPlatform((tx) => routeOf(tx, connectionId))
      if (!route) throw new ExportError('not-found', `no connection ${connectionId}`)
      if (route.blocked) throw new ExportError('blocked', route.blocked)
      const keys = await deps.keyring.forOrg(route.orgId)

      // Everything the export carries, read in one snapshot of the org.
      const read = await deps.router.withTenant(route.orgId, async (tx) => {
        const connection = await connectionById(tx, connectionId)
        if (!connection) throw new ExportError('not-found', `no connection ${connectionId}`)
        if (!connection.exportEnabled) throw new ExportError('disabled', 'Export is not enabled for this connection.')
        const workspace = await workspaceById(tx, connection.workspaceId)
        const documents = await readDocuments({ tx, keys }, connection.workspaceId)
        const { rows: authors } = await tx.query<{ document_id: string; created_by: string }>(
          `SELECT DISTINCT r.document_id, r.created_by FROM document_revisions r JOIN documents d ON d.id = r.document_id
            WHERE d.workspace_id = $1 AND d.origin = 'cloud' AND d.retired_at IS NULL ORDER BY r.created_by`,
          [connection.workspaceId],
        )
        return {
          connection,
          workspace,
          documents,
          authors,
          head: await headOf(tx, connection.workspaceId),
          published: await listPublished(tx, connection.workspaceId),
        }
      })
      const { connection } = read
      const org = await deps.router.withPlatform(async (tx) => {
        const { rows } = await tx.query<{ slug: string }>('SELECT slug FROM platform.orgs WHERE id = $1', [route.orgId])
        return { slug: rows[0]?.slug ?? route.orgId, names: await actorNames(tx, read.authors.map((row) => row.created_by)) }
      })

      const client = deps.github.client(route.installationId)
      const base = await branchHead(client, route.repoFullName, route.branch)
      const rootTree = await commitTree(client, route.repoFullName, base)
      const config = await fileAt(client, route.repoFullName, rootTree, configPathOf(connection.path))
      const layout = docketLayout(connection.path, config?.text ?? null)

      const files: ExportFile[] = []
      const resources: ExportedResource[] = []
      const exported: { documentId: string; path: string; resourceId: string; hash: string }[] = []
      const writers = new Map<string, string[]>()
      for (const row of read.authors) writers.set(row.document_id, [...(writers.get(row.document_id) ?? []), org.names.get(row.created_by) ?? row.created_by])
      for (const document of read.documents) {
        if (document.origin !== 'cloud' || document.raw === undefined) continue
        const path = repoPathFor(layout, document.path)
        const parsed = parseMemoryFile(document.raw, path).document
        files.push({ path, content: document.raw })
        exported.push({ documentId: document.id, path, resourceId: document.resourceId, hash: document.hash })
        resources.push({
          resourceId: document.resourceId,
          type: document.resourceType,
          path,
          links: parsed?.links.length ?? 0,
          evidence: (parsed?.evidence.length ?? 0) + (parsed?.links.reduce((sum, link) => sum + (link.evidence?.length ?? 0), 0) ?? 0),
          actors: [...new Set(writers.get(document.id) ?? [])],
        })
      }

      const repoDocuments = read.documents.flatMap((document) =>
        document.origin === 'repo' && document.originRef === `${connection.id}:${document.path}` && document.raw !== undefined
          ? [{ path: document.path, resourceId: document.resourceId, raw: document.raw }]
          : [],
      )
      const migrated = migratedRepoFiles(read.published, repoDocuments)
      files.push(...migrated.map((file) => ({ path: file.path, content: file.raw })))

      let ontology: { number: number; path: string } | null = null
      if (read.head?.number) {
        const repoOntology = await fileAt(client, route.repoFullName, rootTree, layout.ontologyPath)
        if (!repoOntology || importYaml(repoOntology.text).yaml !== read.head.yaml) {
          files.push({
            path: layout.ontologyPath,
            content: exportYaml({
              org: org.slug,
              workspace: read.workspace?.slug ?? connection.workspaceId,
              number: read.head.number,
              hash: read.head.yamlHash,
              yaml: read.head.yaml,
            }),
          })
          ontology = { number: read.head.number, path: layout.ontologyPath }
        }
      }
      if (!files.length) throw new ExportError('empty', 'Nothing to export: every cloud document is in the repo already, and its ontology matches.')

      const workspaceName = read.workspace?.name ?? connection.workspaceId
      const link = deps.origin && read.workspace ? new URL(`/o/${org.slug}/w/${read.workspace.slug}/repos`, deps.origin).toString() : undefined
      const pr = await openExportPr(client, {
        repo: route.repoFullName,
        base: route.branch,
        branch: exportBranchName(now()),
        files,
        title: `Docket Cloud: export ${resources.length} resource(s) from ${workspaceName}`,
        message: `docket-cloud: export ${resources.length} resource(s) from ${workspaceName}`,
        body: exportSummary({ workspace: workspaceName, resources, ontology, migrated: migrated.map((file) => file.path), ...(link ? { link } : {}) }),
      })

      await deps.router.withTenant(route.orgId, async (tx) => {
        await recordExport(tx, {
          connectionId,
          branch: pr.branch,
          prNumber: pr.number,
          prUrl: pr.url,
          documents: exported,
          ontologyNumber: ontology?.number ?? null,
          createdBy: options.requestedBy ?? EXPORT_ACTOR,
        })
        await audit(tx, {
          orgId: route.orgId,
          workspaceId: connection.workspaceId,
          actor: EXPORT_ACTOR,
          action: 'repo.export',
          target: exported.map((document) => document.resourceId),
          args: { connection: connectionId, pr: pr.url, branch: pr.branch, requestedBy: options.requestedBy ?? null },
          outcome: 'ok',
          latencyMs: performance.now() - startedAt,
          requestId,
        })
      })
      return { prUrl: pr.url, documents: exported.length }
    },
  }
}
