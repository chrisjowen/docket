// SPDX-License-Identifier: AGPL-3.0-only
import { audit, type Outcome } from '@docket/platform-audit'
import { mcpResourceUrl, type McpResource } from '@docket/platform-auth'
import { workspaceBySlug } from '@docket/platform-canonical-store'
import { SLUG } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { rateLimiter } from './rate-limit'
import { clientAddress } from './request'
import type { Runtime } from './runtime'

/**
 * The front of the bearer-token request pipeline (§3 steps 1-3), shared by
 * a workspace's MCP endpoint and the CLI's API under `/api/o/{org}/w/{ws}`:
 * the bearer from the Authorization header, the workspace the path names,
 * and refused credentials, limited per client address and recorded in the
 * platform log as the start of a burst.
 */

export const REFUSAL_WINDOW_MS = 60_000
const bursts = rateLimiter({ limit: 1, windowMs: REFUSAL_WINDOW_MS })

/** The token of `Authorization: Bearer <token>`, or null. */
export function bearerOf(request: Request): string | null {
  return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
}

/** Query parameter names a credential goes by: `access_token`, `token`, `api_key`, `client_secret`, `password`. */
const CREDENTIAL_PARAM = /token|secret|api[-_]?key|password/i

/**
 * Whether a URL carries a credential (§3 step 2, §19): a parameter named like
 * one, or an API token under any name. Such a request is refused, since the
 * URL ends up in proxy and browser logs.
 */
export function credentialInUrl(url: URL): boolean {
  for (const [name, value] of url.searchParams) {
    if (CREDENTIAL_PARAM.test(name) || value.includes('dkt_live_') || value.includes('dmk_')) return true
  }
  return false
}

/** The org and workspace a path names, or null: both must exist, the org active. */
export async function locateWorkspace(runtime: Runtime, orgSlug: string, workspaceSlug: string): Promise<McpResource | null> {
  if (!SLUG.test(orgSlug) || !SLUG.test(workspaceSlug)) return null
  const org = await runtime.router.withPlatform(async (tx) => {
    const { rows } = await tx.query<{ id: string }>("SELECT id FROM platform.orgs WHERE slug = $1 AND status = 'active'", [orgSlug])
    return rows[0] ?? null
  })
  if (!org) return null
  const workspace = await runtime.router.withTenant(org.id, (tx) => workspaceBySlug(tx, workspaceSlug))
  if (!workspace) return null
  return { url: mcpResourceUrl(runtime.origin, orgSlug, workspaceSlug), orgId: org.id, workspaceId: workspace.id }
}

/**
 * Records a refused credential: counted against the client address, and
 * written to the platform log, since it proves nothing about any org - only
 * the first of each minute per address, resource, action and outcome,
 * marked as the start of a burst.
 */
export function refusedCredentials(event: RequestEvent, runtime: Runtime, resourceUrl: string) {
  const address = clientAddress(event) ?? 'unknown'
  return async (action: string, outcome: Outcome) => {
    runtime.refusedAuth.take(address)
    if (!bursts.take(`${address} ${resourceUrl} ${action} ${outcome}`).ok) return
    await runtime.router.withPlatform((tx) =>
      audit(tx, {
        ip: clientAddress(event),
        userAgent: event.request.headers.get('user-agent'),
        requestId: event.locals.requestId,
        orgId: null,
        actor: 'anonymous',
        action,
        target: [resourceUrl, 'burst:true', `window:${REFUSAL_WINDOW_MS / 1000}s`],
        outcome,
        latencyMs: performance.now() - event.locals.startedAt,
      }),
    )
  }
}
