// SPDX-License-Identifier: AGPL-3.0-only
import { namespaceAccess, type Role, type Tx } from '@docket/platform-tenancy'

import type { Principal } from './principal.js'
import { impliedScopes, namespaceScopes, type Scope } from './scopes.js'

type Platform = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

/**
 * Effective permission = the credential's scopes ∩ its owner's permission on
 * its workspace now (§8.4; tenancy design §5.1). The workspace was matched
 * when the bearer resolved; the owner's account role and their grant on that
 * namespace are read on every call, so demoting a member, taking their grant
 * away or removing them narrows every token they hold from their very next
 * call. A credential whose owner holds nothing there - a former member, a
 * member with no grant, a provisioner - has no scopes at all. `ontology:write`
 * also needs the workspace's setting to name the owner's org role, read now
 * through `ontologyWriters` (only for a credential that carries it); without
 * it, it is never effective.
 */
export async function effectiveScopes(
  principal: Principal,
  deps: { platform: Platform; ontologyWriters?: () => Promise<readonly Role[]> },
): Promise<Scope[]> {
  const access = await deps.platform((tx) => namespaceAccess(tx, principal.orgId, principal.workspaceId, principal.userId))
  const writers = principal.scopes.includes('ontology:write') && deps.ontologyWriters ? await deps.ontologyWriters() : []
  const allowed = new Set(namespaceScopes(access, writers))
  return impliedScopes(principal.scopes).filter((scope) => allowed.has(scope))
}

/** Why a call is refused, as the MCP endpoint answers it (RFC 6750 §3.1). */
export type Refusal =
  | { status: 401; error: 'invalid_token'; description: string }
  | { status: 403; error: 'insufficient_scope'; scope: Scope; description: string }

/**
 * Whether effective scopes allow something that needs `needed`: a 401 when
 * the credential no longer carries anything (the owner left the org or lost
 * their access to the workspace), a 403 `insufficient_scope` naming the scope
 * when it carries too little.
 */
export function checkScope(effective: readonly Scope[], needed: Scope): Refusal | null {
  if (effective.length === 0) {
    return { status: 401, error: 'invalid_token', description: 'This credential no longer grants anything in this workspace.' }
  }
  if (!effective.includes(needed)) {
    return { status: 403, error: 'insufficient_scope', scope: needed, description: `This needs the ${needed} scope.` }
  }
  return null
}
