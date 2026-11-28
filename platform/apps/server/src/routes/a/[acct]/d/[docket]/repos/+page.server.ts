// SPDX-License-Identifier: AGPL-3.0-only
import { workspaceBySlug } from '@docket/platform-canonical-store'
import {
  ConnectionError,
  connectionById,
  createConnection,
  disconnect,
  enqueueRepoJob,
  lastJobs,
  latestExports,
  orgInstallations,
  orgRoutes,
  pendingJobs,
  recentIngests,
  setExportEnabled,
  workspaceConnections,
  type Repository,
} from '@docket/platform-github'
import { listDrafts } from '@docket/platform-ontology-service'
import type { Tx } from '@docket/platform-tenancy'
import { error, fail, type RequestEvent } from '@sveltejs/kit'

import { authorise, recordAudit, type OrgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { actorNames, docketAccess, inWorkspace } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

const errorText = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/** The workspace's repo connections (§14.1, §18 "Repos"): last sync and commit, connect a repo, export PRs. */
export const load: PageServerLoad = async (event) => {
  const { githubApp, router, webhookSecret } = getRuntime()
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    // Jobs are read before what they write: the worker records a sync or export, then finishes its job, so a job
    // seen as finished here has its result in the reads below, and the page never misses both.
    const platform = await router.withPlatform(async (tx) => ({
      installations: await orgInstallations(tx, access.org.id),
      routes: await orgRoutes(tx, access.org.id),
      pending: await pendingJobs(tx, access.org.id),
      last: await lastJobs(tx, access.org.id),
    }))
    const connections = await workspaceConnections(ctx.tx, workspace.id)
    return {
      access,
      workspace,
      platform,
      connections,
      exports: await latestExports(ctx.tx, connections.map((connection) => connection.id)),
      ingests: await recentIngests(ctx.tx, { workspaceId: workspace.id, limit: 15 }),
      proposed: (await listDrafts(ctx.tx, workspace.id)).filter((draft) => draft.source.startsWith('repo:')),
    }
  })
  const { access, platform } = read
  const manage = access.can('settings')
  const live = platform.installations.filter((installation) => !installation.deletedAt)

  // What each live installation can read, for the connect form. GitHub being slow or down only hides the form.
  const available: { installationId: number; account: string; repos: Repository[]; error: string | null }[] = []
  if (manage && githubApp) {
    for (const installation of live) {
      try {
        available.push({ installationId: installation.installationId, account: installation.accountLogin, repos: await githubApp.repositories(installation.installationId), error: null })
      } catch (caught) {
        available.push({ installationId: installation.installationId, account: installation.accountLogin, repos: [], error: errorText(caught) })
      }
    }
  }

  const name = await actorNames(access)
  const routes = new Map(platform.routes.map((route) => [route.connectionId, route]))
  return {
    manage,
    configured: githubApp !== null && webhookSecret !== null,
    installations: platform.installations.map((installation) => ({
      id: installation.installationId,
      account: installation.accountLogin,
      state: installation.deletedAt ? 'uninstalled' : installation.suspendedAt ? 'suspended' : 'active',
    })),
    available,
    connections: read.connections.map((connection) => {
      const exported = read.exports.get(connection.id)
      const failed = platform.last.find((job) => job.connectionId === connection.id && job.outcome === 'error' && job.kind === 'export')
      const jobs = platform.pending.filter((job) => job.connectionId === connection.id)
      return {
        id: connection.id,
        repo: connection.repoFullName,
        branch: connection.branch,
        path: connection.path,
        exportEnabled: connection.exportEnabled,
        lastSyncSha: connection.lastSyncSha,
        lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
        lastSyncError: connection.lastSyncError,
        blocked: routes.get(connection.id)?.blocked ?? null,
        syncing: jobs.find((job) => job.kind === 'sync')?.running ?? null,
        exporting: jobs.find((job) => job.kind === 'export')?.running ?? null,
        files: Object.keys(connection.tree).filter((path) => path.endsWith('.md')).length,
        lastExport: exported ? { url: exported.prUrl, number: exported.prNumber, documents: exported.documents.length, at: exported.createdAt.toISOString() } : null,
        exportError: failed && (!exported || failed.finishedAt > exported.createdAt) ? failed.error : null,
      }
    }),
    ingests: read.ingests.map((ingest) => {
      const count = (change: string) => ingest.documents.filter((document) => document.change === change).length
      return {
        id: ingest.id,
        at: ingest.createdAt.toISOString(),
        actor: name(ingest.actor),
        channel: ingest.channel,
        repository: ingest.repository,
        commit: ingest.commit,
        upserted: count('upserted'),
        retired: count('retired'),
        exported: count('exported'),
        documents: ingest.documents,
        notices: ingest.notices,
        outcome: ingest.outcome,
        draftId: ingest.ontologyDraftId,
      }
    }),
    proposed: read.proposed.map((draft) => ({
      id: draft.id,
      message: draft.message,
      classification: draft.checkResult?.classification ?? null,
      createdAt: draft.createdAt.toISOString(),
    })),
    link: event.url.searchParams.get('link'),
    linkedAccount: event.url.searchParams.get('account'),
  }
}

/**
 * Runs `fn` in one transaction that starts as the platform (routes and jobs
 * live there) and then enters the org, with the workspace from the URL path.
 */
async function inPlatformThenWorkspace<T>(
  event: RequestEvent,
  access: OrgAccess,
  fn: (tx: Tx, enter: () => Promise<{ id: string; slug: string }>) => Promise<T>,
): Promise<T> {
  const { router } = getRuntime()
  return router.withPlatform((tx) =>
    fn(tx, async () => {
      await router.enterTenant(tx, access.org.id)
      const workspace = await workspaceBySlug(tx, event.params.docket ?? '')
      if (!workspace) error(404, 'Not found')
      return workspace
    }),
  )
}

/** The connection named in the form, which must belong to the workspace in the URL. */
async function ownConnection(tx: Tx, workspaceId: string, connectionId: string) {
  const connection = await connectionById(tx, connectionId)
  if (!connection || connection.workspaceId !== workspaceId) error(404, 'No such connection.')
  return connection
}

/** Queues a job for a connection the org routes, or answers 404 (`withPlatform`). */
async function queue(tx: Tx, event: RequestEvent, access: OrgAccess, connectionId: string, kind: 'sync' | 'export') {
  const route = await tx.query('SELECT 1 FROM platform.repo_routes WHERE connection_id = $1 AND org_id = $2', [connectionId, access.org.id])
  if (!route.rowCount) error(404, 'No such connection.')
  await enqueueRepoJob(tx, { orgId: access.org.id, connectionId, kind, full: kind === 'sync', requestedBy: `user:${event.locals.user?.id}` })
}

async function managing(event: RequestEvent): Promise<OrgAccess> {
  const { access } = await docketAccess(event)
  authorise(access, 'settings')
  return access
}

export const actions: Actions = {
  /** Connects a repo the org's installation can read, and queues its initial import. */
  connect: async (event) => {
    const access = await managing(event)
    const { githubApp } = getRuntime()
    if (!githubApp) return fail(503, { problem: 'Repo sync is not configured.' })
    const form = await event.request.formData()
    const [installationText, repoText] = String(form.get('repo') ?? '').split(':')
    const installationId = Number(installationText)
    const repoId = Number(repoText)
    const branchField = String(form.get('branch') ?? '').trim()
    const path = String(form.get('path') ?? '').trim() || '.docket/'
    const installations = await getRuntime().router.withPlatform((tx) => orgInstallations(tx, access.org.id))
    if (!installations.some((installation) => installation.installationId === installationId && !installation.deletedAt)) {
      return fail(400, { problem: 'Choose a repo from the list.' })
    }
    let repo: Repository | undefined
    try {
      repo = (await githubApp.repositories(installationId)).find((candidate) => candidate.id === repoId)
    } catch (caught) {
      return fail(502, { problem: `GitHub did not answer: ${errorText(caught)}` })
    }
    if (!repo) return fail(400, { problem: 'The GitHub App cannot read that repo. Install it on the repo first.' })
    const branch = branchField || repo.defaultBranch
    try {
      const connection = await inPlatformThenWorkspace(event, access, async (tx, enter) => {
        const created = await createConnection(tx, {
          orgId: access.org.id,
          installationId,
          repo: { id: repo.id, fullName: repo.fullName },
          branch,
          path,
          createdBy: `user:${event.locals.user?.id}`,
          requestId: event.locals.requestId,
          enterWorkspace: async () => (await enter()).id,
        })
        await recordAudit(tx, event, {
          action: 'repos.connect',
          orgId: access.org.id,
          workspaceId: created.workspaceId,
          target: [`${repo.fullName}@${branch}:${created.path}`],
        })
        return created
      })
      return { flash: `Connected ${connection.repoFullName}@${connection.branch}. The first import runs now.` }
    } catch (caught) {
      if (caught instanceof ConnectionError) return fail(caught.code === 'conflict' ? 409 : 400, { problem: caught.message })
      throw caught
    }
  },

  /** Queues a full sync now: every file, not only changed blobs (§14.1 "Resync now"). */
  resync: async (event) => {
    const access = await managing(event)
    const connectionId = String((await event.request.formData()).get('connection') ?? '')
    await inPlatformThenWorkspace(event, access, async (tx, enter) => {
      await queue(tx, event, access, connectionId, 'sync')
      const workspace = await enter()
      const connection = await ownConnection(tx, workspace.id, connectionId)
      await recordAudit(tx, event, { action: 'repos.resync', orgId: access.org.id, workspaceId: workspace.id, target: [connection.repoFullName] })
    })
    return { flash: 'Resync queued.' }
  },

  /** Turns export PRs on or off for a connection. */
  exports: async (event) => {
    const access = await managing(event)
    const form = await event.request.formData()
    const connectionId = String(form.get('connection') ?? '')
    const enabled = form.get('enabled') === 'on'
    return inWorkspace(event, async ({ workspace, ctx }) => {
      await ownConnection(ctx.tx, workspace.id, connectionId)
      const connection = await setExportEnabled(ctx.tx, connectionId, enabled)
      await recordAudit(ctx.tx, event, {
        action: enabled ? 'repos.export.enable' : 'repos.export.disable',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: [connection.repoFullName],
      })
      return { flash: enabled ? `Export PRs are on for ${connection.repoFullName}.` : `Export PRs are off for ${connection.repoFullName}.` }
    })
  },

  /** "Export cloud knowledge": queues an export PR (§14.3). */
  export: async (event) => {
    const access = await managing(event)
    const connectionId = String((await event.request.formData()).get('connection') ?? '')
    return inPlatformThenWorkspace(event, access, async (tx, enter) => {
      // Queued first, in the platform; the org check below rolls it back if the connection is not this workspace's.
      await queue(tx, event, access, connectionId, 'export')
      const workspace = await enter()
      const connection = await ownConnection(tx, workspace.id, connectionId)
      if (!connection.exportEnabled) error(409, 'Turn on export PRs for this connection first.')
      await recordAudit(tx, event, { action: 'repos.export', orgId: access.org.id, workspaceId: workspace.id, target: [connection.repoFullName] })
      return { flash: `Export queued: a PR against ${connection.repoFullName}@${connection.branch} opens shortly.` }
    })
  },

  /** Disconnects a repo: pushes stop syncing; its documents stay until retired. */
  disconnect: async (event) => {
    const access = await managing(event)
    const connectionId = String((await event.request.formData()).get('connection') ?? '')
    return inPlatformThenWorkspace(event, access, async (tx, enter) => {
      const connection = await disconnect(tx, {
        orgId: access.org.id,
        connectionId,
        enterWorkspace: async () => ownConnection(tx, (await enter()).id, connectionId),
      })
      await recordAudit(tx, event, { action: 'repos.disconnect', orgId: access.org.id, workspaceId: connection.workspaceId, target: [connection.repoFullName] })
      return { flash: `Disconnected ${connection.repoFullName}. Its documents stay until you retire them.` }
    })
  },
}
