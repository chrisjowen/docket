// SPDX-License-Identifier: AGPL-3.0-only
import { accessOf, capsAt, docketPlace, type Tx } from '@docket/platform-tenancy'

import type { Principal } from './principal.js'
import { capabilityScopes, impliedScopes, type Scope } from './scopes.js'

type Platform = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

/**
 * Effective permission = the credential's ceiling ∩ what its owner may do on
 * its docket now (§8.4; tenancy v2 §3.4): their capabilities there, from
 * every grant that covers it (`capsAt`, the resolver every surface uses).
 * The docket was matched when the bearer resolved; the owner's grants are
 * read on every call, so taking a grant away or removing them narrows every
 * token and connection they hold from their very next call. A credential
 * whose owner holds nothing there - a former member, one with no grant, a
 * role that manages without reading - has no scopes at all.
 */
export async function effectiveScopes(principal: Principal, deps: { platform: Platform }): Promise<Scope[]> {
  const access = await deps.platform((tx) => accessOf(tx, principal.orgId, principal.userId))
  const allowed = new Set(capabilityScopes(capsAt(access, docketPlace(principal.workspaceId))))
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
