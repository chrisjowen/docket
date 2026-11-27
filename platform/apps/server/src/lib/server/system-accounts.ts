// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, type Tx } from '@docket/platform-tenancy'
import { fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit'

import { authorise, orgAccess, recordAudit, requireUser, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * Settings › System accounts (tenancy v2 §3.3): the one place to create a
 * system account, give it access, and issue and revoke its tokens. Anyone who
 * manages the account's access (owners and admins) does it here.
 */

/** The access a system account holds across the account, as its role reads. */
export const ROLE_LABELS = {
  viewer: 'Reader: reads every docket',
  editor: 'Writer: reads and writes every docket',
  admin: 'Admin: every capability on every docket',
} as const

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
  authorise(access, 'members.manage')
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
