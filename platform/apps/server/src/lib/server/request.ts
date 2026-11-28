// SPDX-License-Identifier: AGPL-3.0-only
import { audit, type AuditEventInput, type Outcome } from '@docket/platform-audit'
import {
  ACCOUNT,
  accessOf,
  can,
  capsAt,
  docketPlace,
  membershipBySlug,
  seesDocket as sees,
  type Access,
  type Capability,
  type Org,
  type Place,
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
  /** On the beta or sign-in allowlist: may create orgs. */
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

/** Whether the user runs the platform (`DOCKET_PLATFORM_ADMINS`: their login or a verified email), which no org role grants. */
export function isPlatformAdmin(user: Pick<SignedIn, 'login' | 'emails'> | null): boolean {
  if (user === null) return false
  const admins = getRuntime().platformAdmins
  return admins.has(user.login.toLowerCase()) || user.emails.some((email) => admins.has(email.toLowerCase()))
}

/** The signed-in platform admin. Anyone else signed in gets 404, so the admin pages do not show that they exist. */
export function requirePlatformAdmin(event: RequestEvent): SignedIn {
  const user = requireUser(event)
  if (!isPlatformAdmin(user)) error(404, 'Not found')
  return user
}

export interface OrgAccess {
  org: Org
  /** The member's access: whether they own the account or are a guest in it, and every grant that applies to them. */
  principal: Access
  /** Owns the account: the only one who administers it (billing, the AI cap, ownership, deleting it). */
  owner: boolean
  /** Whether they hold `cap` on the whole account. */
  can(cap: Capability): boolean
  /** Whether they hold `cap` anywhere in the account: on the account or on any docket. */
  canAnywhere(cap: Capability): boolean
  /** What they may do on a place: the resolver every surface uses (tenancy v2 §3.1). */
  capsAt(place: Place): ReadonlySet<Capability>
}

/** An account's access as every route reads it, from the principal's access there (`accessOf`), narrowed or not. */
export function orgAccessOf(org: Org, principal: Access): OrgAccess {
  return {
    org,
    principal,
    owner: principal.owner,
    can: (cap) => capsAt(principal, ACCOUNT).has(cap),
    canAnywhere: (cap) => can(principal, cap),
    capsAt: (place) => capsAt(principal, place),
  }
}

/**
 * The org named in the URL path (never the body, §3) and what the user may
 * do in it. Not a member, no such org, a deleted org: all 404, never 403, so
 * the answer reveals nothing about orgs the user is not in (§5.5).
 */
export async function orgAccess(event: RequestEvent, options: { api?: boolean } = {}): Promise<OrgAccess> {
  const user = event.locals.user
  if (!user) {
    if (options.api) error(401, 'Sign in first.')
    requireUser(event)
    throw new Error('unreachable')
  }
  const slug = event.params.acct ?? ''
  const found = await getRuntime().router.withPlatform(async (tx) => {
    const membership = await membershipBySlug(tx, slug, user.id)
    const principal = membership && (await accessOf(tx, membership.org.id, user.id))
    return membership && principal ? { org: membership.org, principal } : null
  })
  if (!found) error(404, 'Not found')
  event.locals.auditOrgId = found.org.id
  return orgAccessOf(found.org, found.principal)
}

/** Refuses what the member may not do on the whole account. Members get 403: they know the org exists. */
export function authorise(access: OrgAccess, cap: Capability): void {
  if (!access.can(cap)) error(403, 'You do not have access to that.')
}

/** Refuses what the member may not do anywhere in the account: a page that then shows only the places where they may. */
export function authoriseAnywhere(access: OrgAccess, cap: Capability): void {
  if (!access.canAnywhere(cap)) error(403, 'You do not have access to that.')
}

/** Refuses anyone but an owner of the account. */
export function authoriseOwner(access: OrgAccess): void {
  if (!access.owner) error(403, 'Only an owner of the account can do that.')
}

/** Whether the member reads one of the org's dockets: what lists, search and Ask cover. */
export function readsDocket(access: OrgAccess, workspaceId: string): boolean {
  return access.capsAt(docketPlace(workspaceId)).has('read')
}

/** Whether the member sees that a docket exists: everyone but a guest sees them all, a guest only those it holds something on. */
export function seesDocket(access: OrgAccess, workspaceId: string): boolean {
  return sees(access.principal, workspaceId)
}

export interface NamespaceAccess extends OrgAccess {
  /** What the member may do on this docket. */
  caps: ReadonlySet<Capability>
}

/**
 * The member's access to one of the org's dockets: what every grant covering
 * it gives them, which must include reading it. A docket they cannot see is
 * 404, like one the org does not have (§5.5); one they see but may not read
 * is 403. Inside it, `can` answers for this docket.
 */
export function namespaceAccess(access: OrgAccess, workspace: { id: string }): NamespaceAccess {
  const caps = access.capsAt(docketPlace(workspace.id))
  if (!caps.has('read')) {
    if (!seesDocket(access, workspace.id)) error(404, 'Not found')
    error(403, 'You have no access to this docket.')
  }
  return { ...access, caps, can: (cap) => caps.has(cap) }
}
