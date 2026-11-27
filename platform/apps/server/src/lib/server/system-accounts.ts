// SPDX-License-Identifier: AGPL-3.0-only
import { ACCOUNT, TenancyError, docketPlace, spacePlace, type Tx } from '@docket/platform-tenancy'
import { fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit'

import { orgAccess, recordAudit, requireUser, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * Settings › System accounts (tenancy v2 §3.3): the one place to create a
 * system account, give it access, and issue and revoke its tokens. Anyone who
 * manages system accounts somewhere does it here, for the places they manage.
 */

/** Whether the member manages system accounts (or access) anywhere: who reaches Settings › System accounts at all. */
export function mayManageSystemAccounts(access: OrgAccess): boolean {
  return access.owner || access.canAnywhere('system') || access.canAnywhere('access')
}

/**
 * Whether the member may see or change one system account: they manage
 * system accounts (or access) on a place its grants reach; one that reaches
 * nothing yet only to those who manage system accounts on the whole account,
 * or own it.
 */
export function mayChangeAccount(access: OrgAccess, grants: readonly { place: { key: string } }[]): boolean {
  if (access.owner) return true
  const manages = (key: string) => {
    const caps = access.capsAt(key === 'account' ? ACCOUNT : key.startsWith('space:') ? spacePlace(key.slice(6)) : docketPlace(key.slice(7)))
    return caps.has('system') || caps.has('access')
  }
  return grants.length ? grants.some((grant) => manages(grant.place.key)) : access.can('system') || access.can('access')
}

/** What a system account may do, in a line: each of its grants as a role on a place. */
export function accessSummary(grants: readonly { label: string; place: { label: string } }[]): string {
  return grants.length ? grants.map((grant) => `${grant.label} on ${grant.place.label}`).join('; ') : 'Nothing yet: give it access below'
}

/** One change to a system account, audited in the org's own log in the same transaction (§10). */
export async function manage<T extends { flash: string }>(
  event: RequestEvent,
  change: (
    tx: Tx,
    scope: { access: OrgAccess; userId: string; form: FormData },
  ) => Promise<T & { action: string; target: string[]; args?: unknown }>,
  refusals: (cause: unknown) => ActionFailure<{ problem: string }> | null = () => null,
): Promise<ActionFailure<{ problem: string }> | Omit<T, 'action' | 'target' | 'args'>> {
  const user = requireUser(event)
  const access = await orgAccess(event)
  if (!mayManageSystemAccounts(access)) return fail(403, { problem: 'You do not manage system accounts.' })
  const form = await event.request.formData()
  const { router } = getRuntime()
  try {
    return await router.withPlatform(async (tx) => {
      const result = await change(tx, { access, userId: user.id, form })
      await router.enterTenant(tx, access.org.id)
      await recordAudit(tx, event, { action: result.action, orgId: access.org.id, target: result.target, args: result.args })
      const shown: Partial<typeof result> = { ...result }
      delete shown.action
      delete shown.target
      delete shown.args
      return shown as Omit<T, 'action' | 'target' | 'args'>
    })
  } catch (cause) {
    if (cause instanceof TenancyError) return fail(cause.code === 'forbidden' ? 403 : cause.code === 'not-found' ? 404 : 400, { problem: cause.message })
    const refused = refusals(cause)
    if (refused) return refused
    throw cause
  }
}
