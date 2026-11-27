// SPDX-License-Identifier: AGPL-3.0-only
import { audit, type AuditEventInput, type Outcome } from '@docket/platform-audit'
import {
  can,
  canInNamespace,
  membershipBySlug,
  namespaceGrantsOf,
  namespacePermission,
  namespaceVisible,
  type AccountRole,
  type Action,
  type NamespaceAction,
  type NamespacePermission,
  type Org,
  type Role,
  type Tx,
} from '@docket/platform-tenancy'
import { error, redirect, type RequestEvent } from '@sveltejs/kit'

import { getRuntime } from './runtime'

/** The signed-in user, as a request sees them. */
export interface SignedIn {
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
  emails: string[]
  /** On the beta allowlist: may create orgs. */
  allowlisted: boolean
}

export function clientAddress(event: RequestEvent): string | null {
  try {
    return event.getClientAddress()
  } catch {
    return null
  }
}

/** The audit event for this request: who, from where, how long it took so far. */
export function auditInput(
  event: RequestEvent,
  fields: Pick<AuditEventInput, 'action' | 'outcome' | 'orgId'> & Partial<AuditEventInput>,
): AuditEventInput {
  return {
    actor: event.locals.user ? `user:${event.locals.user.id}` : 'anonymous',
    ip: clientAddress(event),
    userAgent: event.request.headers.get('user-agent'),
    latencyMs: performance.now() - event.locals.startedAt,
    requestId: event.locals.requestId,
    ...fields,
  }
}

/** Writes the request's audit event inside the transaction that made its change (§10). */
export async function recordAudit(
  tx: Tx,
  event: RequestEvent,
  fields: Pick<AuditEventInput, 'action' | 'orgId'> & Partial<AuditEventInput>,
): Promise<void> {
  await audit(tx, auditInput(event, { outcome: 'ok', ...fields }))
  event.locals.audited = true
}

/** Writes an audit event on its own, for a request that changed nothing (a refusal, a read). */
export async function recordStandalone(
  event: RequestEvent,
  fields: { action: string; outcome: Outcome; orgId: string | null; target?: string[]; args?: unknown },
): Promise<void> {
  const { router } = getRuntime()
  const write = (tx: Tx) => audit(tx, auditInput(event, fields))
  if (fields.orgId) await router.withTenant(fields.orgId, write)
  else await router.withPlatform(write)
  event.locals.audited = true
}

/** The signed-in user, or a redirect to sign in that comes back here. */
export function requireUser(event: RequestEvent): SignedIn {
  const user = event.locals.user
  if (!user) {
    const next = event.url.pathname + event.url.search
    redirect(303, `/signin?next=${encodeURIComponent(next)}`)
  }
  return user
}

/** Whether the user runs the platform (`DOCKET_PLATFORM_ADMINS`), which no org role grants. */
export function isPlatformAdmin(user: Pick<SignedIn, 'login'> | null): boolean {
  return user !== null && getRuntime().platformAdmins.has(user.login.toLowerCase())
}

/** The signed-in platform admin. Anyone else signed in gets 404, so the admin pages do not show that they exist. */
export function requirePlatformAdmin(event: RequestEvent): SignedIn {
  const user = requireUser(event)
  if (!isPlatformAdmin(user)) error(404, 'Not found')
  return user
}

export interface OrgAccess {
  org: Org
  role: Role
  /** The member's account role: with their grants, it decides which of the org's dockets they reach. */
  accountRole: AccountRole
  /** The member's namespace grants, by workspace id. */
  grants: ReadonlyMap<string, NamespacePermission>
  can(action: Action): boolean
}

/**
 * The org named in the URL path (never the body, §3) and the user's role in
 * it. Not a member, no such org, a deleted org: all 404, never 403, so the
 * answer reveals nothing about orgs the user is not in (§5.5).
 */
export async function orgAccess(event: RequestEvent, options: { api?: boolean } = {}): Promise<OrgAccess> {
  const user = event.locals.user
  if (!user) {
    if (options.api) error(401, 'Sign in first.')
    requireUser(event)
    throw new Error('unreachable')
  }
  const slug = event.params.org ?? ''
  const found = await getRuntime().router.withPlatform(async (tx) => {
    const membership = await membershipBySlug(tx, slug, user.id)
    return membership && { ...membership, grants: await namespaceGrantsOf(tx, membership.org.id, user.id) }
  })
  if (!found) error(404, 'Not found')
  event.locals.auditOrgId = found.org.id
  return { org: found.org, role: found.role, accountRole: found.accountRole, grants: found.grants, can: (action) => can(found.role, action) }
}

/** Refuses an action the role does not allow. Members get 403: they know the org exists. */
export function authorise(access: OrgAccess, action: Action): void {
  if (!access.can(action)) error(403, 'Your role does not allow that.')
}

/** The member's permission on one of the org's dockets: their account role's, joined with their grant there. */
export function permissionOn(access: OrgAccess, workspaceId: string): NamespacePermission | null {
  const grant = access.grants.get(workspaceId)
  return namespacePermission(access.accountRole, grant ? [grant] : [])
}

/** Whether the member sees that a docket exists: everyone but a guest sees them all, a guest only those it was granted. */
export function seesDocket(access: OrgAccess, workspaceId: string): boolean {
  const grant = access.grants.get(workspaceId)
  return namespaceVisible(access.accountRole, grant ? [grant] : [])
}

/** What a docket's own permission decides; the rest (members, trust, the org's caps) stays with the org role. */
const IN_DOCKET: Partial<Record<Action, NamespaceAction>> = {
  'graph.read': 'graph.read',
  'knowledge.write': 'knowledge.write',
  'ontology.propose': 'ontology.propose',
  'ontology.publish': 'ontology.publish',
  'repos.connect': 'repos.connect',
  'workspaces.delete': 'namespace.delete',
  'enrichment.manage': 'enrichment.manage',
  'projections.manage': 'projections.manage',
  'tokens.create-own': 'tokens.create-own',
  'tokens.manage': 'tokens.manage',
  'proposals.override': 'proposals.override',
  'audit.view-full': 'audit.view-full',
  'audit.view-own': 'audit.view-own',
}

/** The per-org role that does in one docket what a permission there does. */
const ROLE_FOR: Record<NamespacePermission, Role> = { admin: 'admin', write: 'editor', read: 'viewer' }

export interface NamespaceAccess extends OrgAccess {
  /** The member's permission on this docket. */
  permission: NamespacePermission
  /**
   * The per-org role that reaches in this docket what `permission` does (an
   * owner stays one), for what is still keyed by role: the scopes a token may
   * carry and the workspace's MCP ontology writers.
   */
  roleHere: Role
}

/**
 * The member's access to one of the org's dockets: allowed by their account
 * role or a grant there. A docket they cannot see is 404, like one the org
 * does not have (§5.5); one they see but were not granted is 403. Inside it,
 * `can` answers the docket's own actions from that permission.
 */
export function namespaceAccess(access: OrgAccess, workspace: { id: string }): NamespaceAccess {
  const permission = permissionOn(access, workspace.id)
  if (permission === null) {
    if (!seesDocket(access, workspace.id)) error(404, 'Not found')
    error(403, 'You have no access to this docket.')
  }
  return {
    ...access,
    permission,
    roleHere: access.role === 'owner' ? 'owner' : ROLE_FOR[permission],
    can: (action) => {
      const inDocket = IN_DOCKET[action]
      return inDocket ? canInNamespace(permission, inDocket) : access.can(action)
    },
  }
}
