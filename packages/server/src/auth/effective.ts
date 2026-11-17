import type { Authorizer, Principal } from '../ports.js'
import { impliedScopes, roleScopes, type Scope } from './scopes.js'

/**
 * Effective permission = the credential's scopes ∩ its subject's role now ∩
 * its workspace. The workspace was matched when the bearer resolved; the role
 * is read on every call, so demoting or removing a member narrows every
 * token they hold from their very next call. A former member's credential
 * has no scopes at all. `ontology:write` also needs the workspace's setting
 * to name the role, read now through `ontologyWriters` (only for a
 * credential that carries it); without it, it is never effective.
 */
export async function effectiveScopes<P extends Principal>(principal: P, authorizer: Authorizer<P>): Promise<Scope[]> {
  const role = await authorizer.role(principal)
  const writers =
    principal.scopes.includes('ontology:write') && authorizer.ontologyWriters
      ? await authorizer.ontologyWriters(principal.workspaceId)
      : []
  const allowed = new Set(roleScopes(role, writers))
  return impliedScopes(principal.scopes).filter((scope) => allowed.has(scope))
}

/** Why a call is refused, as the MCP endpoint answers it (RFC 6750 §3.1). */
export type Refusal =
  | { status: 401; error: 'invalid_token'; description: string }
  | { status: 403; error: 'insufficient_scope'; scope: Scope; description: string }

/**
 * Whether effective scopes allow something that needs `needed`: a 401 when
 * the credential no longer carries anything (its subject left), a 403
 * `insufficient_scope` naming the scope when it carries too little.
 */
export function checkScope(effective: readonly Scope[], needed: Scope): Refusal | null {
  if (effective.length === 0) {
    return { status: 401, error: 'invalid_token', description: 'This credential no longer grants anything in this organisation.' }
  }
  if (!effective.includes(needed)) {
    return { status: 403, error: 'insufficient_scope', scope: needed, description: `This needs the ${needed} scope.` }
  }
  return null
}
