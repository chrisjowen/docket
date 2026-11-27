// SPDX-License-Identifier: AGPL-3.0-only
import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { chatOf, type Models } from '@docket/platform-ai'
import { workspaceById } from '@docket/platform-canonical-store'
import { askWorkspace, type StoreAccess } from '@docket/platform-projections'
import type { TenantRouter } from '@docket/platform-tenancy'

export interface AskRequest {
  orgId: string
  workspaceId: string
  question: string
  /** Who asked, as metered: for example `user:<id>`. */
  actor: string
}

export class UnknownWorkspace extends Error {
  override name = 'UnknownWorkspace'
}

export interface AskerDeps {
  router: TenantRouter
  storeAccess(orgId: string): Promise<StoreAccess>
  /** The org's metered, capped models (`openRouterModels`), on its own key or the platform's shared one. */
  modelsFor(orgId: string, context: { workspaceId: string; actor: string }): Models
}

/**
 * Answers a question over a workspace with the org's Cypher model (§6.3,
 * §11): every model call checks the org's cap, runs on its key, and is
 * metered. Nothing serves it yet: the caller must take `orgId` and
 * `workspaceId` from an authenticated URL path, never from a request body (§3).
 */
export function workspaceAsker(deps: AskerDeps): (request: AskRequest) => Promise<AdapterAnswer> {
  return async ({ orgId, workspaceId, question, actor }) => {
    const workspace = await deps.router.withTenant(orgId, (tx) => workspaceById(tx, workspaceId))
    if (!workspace) throw new UnknownWorkspace(`no workspace ${workspaceId} in org ${orgId}`)
    const cypher = deps.modelsFor(orgId, { workspaceId, actor }).cypher
    if (!cypher) throw new Error('the org has no cypher model')
    return askWorkspace({ orgId, workspaceId, access: await deps.storeAccess(orgId), question, cypher: chatOf(cypher) })
  }
}
