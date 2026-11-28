// SPDX-License-Identifier: AGPL-3.0-only
import { docketCapScope } from '@docket/platform-ai'
import { describeResource, listDocuments, listIngests, listWorkspaces, workspaceGraph, type StoreContext } from '@docket/platform-canonical-store'
import { readTools } from '@docket/platform-mcp-tools'

import { MAX_SOURCES, type TypeSlots } from '$lib/ask/model'
import type { ActivityEntry } from '$lib/graph/browse'
import { typeSlots } from '$lib/graph/model'

import { ACTIVITY_SHOWN, activityEntries } from './activity'
import type { AskDeps, CanonicalGraph, OrgWorkspace } from './ask'
import type { AgentDeps } from './ask-agent'
import { readsDocket, type OrgAccess } from './request'
import { getRuntime } from './runtime'
import { activityActors, actorNames, inOrg } from './workspace'

/**
 * What asking and searching the org's dockets reads, as the member: the
 * query service, the AI budget, and each docket's documents and activity log,
 * read as the org. The Ask page and the command menu share it.
 */
export function askDeps(access: OrgAccess, userId: string): AskDeps {
  const runtime = getRuntime()
  return {
    orgId: access.org.id,
    actor: `user:${userId}`,
    userId,
    query: runtime.query,
    assertWithinCap: async (workspaceId) =>
      runtime.caps.assertWithinCap(access.org.id, await runtime.router.withPlatform((tx) => docketCapScope(tx, access.org.id, workspaceId))),
    graphs: (workspaces) =>
      inOrg(access, async (ctx: StoreContext) => {
        const graphs = new Map<string, CanonicalGraph>()
        for (const workspace of workspaces) {
          graphs.set(workspace.slug, await workspaceGraph(ctx, workspace, { root: `/o/${access.org.slug}/w/${workspace.slug}` }))
        }
        return graphs
      }),
    activity: async (workspaces) => {
      const display = activityActors(await actorNames(access))
      return inOrg(access, async (ctx: StoreContext) => {
        const activity = new Map<string, ActivityEntry[]>()
        for (const workspace of workspaces) {
          activity.set(workspace.slug, activityEntries(await listIngests(ctx, { workspaceId: workspace.id, limit: ACTIVITY_SHOWN }), display))
        }
        return activity
      })
    },
    describe: (wanted) =>
      inOrg(access, async (ctx: StoreContext) => {
        const described = new Map<string, Map<string, { title: string; type: string }>>()
        for (const { workspace, ids } of wanted) {
          const found = new Map<string, { title: string; type: string }>()
          for (const id of ids.slice(0, MAX_SOURCES * 2)) {
            const resource = await describeResource(ctx, workspace.id, id)
            if (resource) found.set(id, resource)
          }
          described.set(workspace.slug, found)
        }
        return described
      }),
  }
}

/**
 * What the Ask page's agent runs on, as the member: each docket's MCP read
 * tools, built as the MCP endpoint builds them, and the worker for each turn
 * of the org's model. Its `docket_ask` is the grounded retrieval alone, with
 * no summary: the agent writes the answer. It reads only, so it never writes.
 */
export function agentDeps(access: OrgAccess, userId: string): AgentDeps {
  const runtime = getRuntime()
  const asking = askDeps(access, userId)
  const query = { ...runtime.query, ask: (ask: Parameters<typeof runtime.query.ask>[0]) => runtime.query.ask({ ...ask, summary: false }) }
  const readOnly = () => Promise.reject(new Error('The Ask page reads the dockets; it never writes.'))
  return {
    orgId: asking.orgId,
    actor: asking.actor,
    userId,
    query: runtime.query,
    describe: asking.describe,
    tools: (workspace) =>
      readTools({
        orgId: access.org.id,
        workspaceId: workspace.id,
        viewer: new URL(`/o/${access.org.slug}/w/${workspace.slug}/graph`, runtime.origin).toString(),
        ontologyHistory: new URL(`/o/${access.org.slug}/w/${workspace.slug}/ontology/history`, runtime.origin).toString(),
        inTenant: (fn) => inOrg(access, fn),
        query,
        assertWithinCap: () => asking.assertWithinCap(workspace.id),
        actor: asking.actor,
        userId,
        writer: readOnly,
        mayPublish: async () => false,
        audited: readOnly,
      }),
  }
}

/**
 * Each workspace's record types, ranked as its Record page ranks them, from
 * its documents' index alone: nothing is decrypted to read a type.
 */
export const typeRanks = (access: OrgAccess, workspaces: readonly OrgWorkspace[]): Promise<TypeSlots> =>
  inOrg(access, async ({ tx }) => {
    const ranks: TypeSlots = {}
    for (const workspace of workspaces) {
      const records = new Map((await listDocuments(tx, workspace.id)).map((document) => [document.resourceId, { type: document.resourceType }]))
      ranks[workspace.slug] = Object.fromEntries(typeSlots([...records.values()]))
    }
    return ranks
  })

/** The org's workspaces the member reads: those a grant lets them read. */
export const orgWorkspaces = async (access: OrgAccess): Promise<OrgWorkspace[]> =>
  (await inOrg(access, ({ tx }) => listWorkspaces(tx)))
    .filter((workspace) => readsDocket(access, workspace.id))
    .map(({ id, slug, name }) => ({ id, slug, name }))
