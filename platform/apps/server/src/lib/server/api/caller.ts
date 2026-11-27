// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiErrorCode } from '@docket/api'
import { SCOPES, type AccountPrincipal } from '@docket/platform-auth'
import {
  accessOf,
  capsAt,
  docketPlace,
  membershipBySlug,
  userById,
  type Access,
  type Org,
  type Role,
} from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import { bearerOf } from '../bearer'
import { orgAccessOf, type OrgAccess, type SignedIn } from '../request'
import { getRuntime } from '../runtime'

/**
 * Who an `/api/v1` call is from (open-source plan §1; tenancy v2 §3.4): a
 * browser session, or a bearer - an API token or an OAuth access token from a
 * named connection - which acts as its owner, narrowed. Both resolve to the
 * same principal, and what it may do anywhere is `capsAt` on its grants.
 */

export class ApiFailure extends Error {
  override name = 'ApiFailure'
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: { path: string; message: string }[],
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export interface Caller {
  user: { id: string; login: string; name: string | null; kind: 'human' | 'service' }
  via: 'session' | 'token' | 'oauth'
  /** The signed-in user, for a session. */
  session: SignedIn | null
  /** The token or connection, for a bearer: read-only, and the dockets it reaches (null: every docket its owner reaches). */
  credential: AccountPrincipal | null
  /** How the call reads in the audit log: `user:<id>`, `token:<prefix>`, `oauth:<client>/conn:<grant>/user:<id>`. */
  actor: string
}

/**
 * The caller in one account: their access there, already narrowed to what
 * their credential reaches, in the shape every other route reads (`OrgAccess`),
 * so the same checks answer for the API as for the app's buttons.
 */
export interface AccountCaller extends OrgAccess {
  caller: Caller
}

/** The caller a request authenticates as, or an `unauthenticated` / `invalid_token` refusal. */
export async function authenticate(event: RequestEvent): Promise<Caller> {
  const runtime = getRuntime()
  const bearer = bearerOf(event.request)
  if (bearer) {
    const credential = await runtime.tokens.resolveCredential(bearer)
    const user = credential && (await runtime.router.withPlatform((tx) => userById(tx, credential.userId)))
    // A grant made before named connections is for its one docket's MCP address only.
    if (!credential || !user || credential.audience !== null) {
      throw new ApiFailure('invalid_token', 'This token is not valid: unknown, expired or revoked.', undefined, { 'www-authenticate': 'Bearer error="invalid_token"' })
    }
    return {
      user: { id: user.id, login: user.login, name: user.name, kind: user.kind },
      via: credential.via,
      session: null,
      credential,
      actor: credential.actor,
    }
  }
  const session = event.locals.user
  if (!session) throw new ApiFailure('unauthenticated', 'Sign in, or send Authorization: Bearer <token>.', undefined, { 'www-authenticate': 'Bearer' })
  return {
    user: { id: session.id, login: session.login, name: session.name, kind: 'human' },
    via: 'session',
    session,
    credential: null,
    actor: `user:${session.id}`,
  }
}

/**
 * Whether a credential may only read here: a read-only one, or one that still
 * carries a ceiling from before scopes went (an API token or connection made
 * before platform migration 0015), which never covers management.
 */
export function readsOnly(credential: Pick<AccountPrincipal, 'readOnly' | 'scopes'>): boolean {
  return credential.readOnly === true || !SCOPES.every((scope) => credential.scopes.includes(scope))
}

const CREDENTIAL_ROLE: Omit<Role, 'caps'> = { id: 'credential', name: 'This token or connection', description: null, builtin: false }

/**
 * A principal's access cut to what a credential reaches (tenancy v2 §3.4):
 * one limited to some dockets holds exactly its owner's capabilities on each
 * of them, and nothing on the account or any space; one that reaches every
 * docket holds all its owner holds. Read-only is answered per call (only
 * read-only operations), so it is not cut here.
 */
export function narrowed(access: Access, credential: Pick<AccountPrincipal, 'dockets'> | null): Access {
  // Undefined or null: every docket its owner reaches.
  if (!credential?.dockets) return access
  return {
    ...access,
    owner: false,
    grants: credential.dockets.map((id) => ({
      id: `credential:${id}`,
      who: { kind: 'user' as const, id: access.userId },
      place: docketPlace(id),
      role: { ...CREDENTIAL_ROLE, caps: [...capsAt(access, docketPlace(id))] },
      add: [],
      remove: [],
    })),
  }
}

/**
 * The account a call names (by slug, in its path or body) and the caller's
 * access there. Not a member, no such account, a deleted one, or a bearer
 * from another account: all 404, so the answer says nothing about accounts
 * the caller is not in.
 */
export async function accountCaller(caller: Caller, slug: string): Promise<AccountCaller> {
  const { router } = getRuntime()
  const found = await router.withPlatform(async (tx) => {
    const membership = await membershipBySlug(tx, slug, caller.user.id)
    if (!membership || (caller.credential && caller.credential.orgId !== membership.org.id)) return null
    const access = await accessOf(tx, membership.org.id, caller.user.id)
    return access ? { org: membership.org as Org, access } : null
  })
  if (!found) throw new ApiFailure('not_found', 'Not found.')
  return { ...orgAccessOf(found.org, narrowed(found.access, caller.credential)), caller }
}
