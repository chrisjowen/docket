// SPDX-License-Identifier: AGPL-3.0-only
import type * as Wire from '@docket/api'
import {
  DEFAULT_ACCOUNT_LIMITS,
  TenancyError,
  countLiveOrgs,
  operatorAccount,
  operatorAccounts,
  setAccountLimits,
  setAccountSuspended,
  type OperatorAccount,
  type Tx,
} from '@docket/platform-tenancy'
import type { z } from 'zod'

import { getRuntime } from './runtime'

/**
 * The operator console (tenancy v2 §3.5, phase 6.3), for the platform's
 * operators (`DOCKET_PLATFORM_ADMINS`) and no one else: list the accounts,
 * suspend and resume one, set its limits. The page and `/api/v1/operator/…`
 * do the same here. Nothing reads an account's content, and every change is
 * recorded in the platform's audit log.
 */

type Out<T extends z.ZodType> = z.output<T>

export const operatorAccountView = (account: OperatorAccount): Out<typeof Wire.OperatorAccount> => ({
  id: account.id,
  slug: account.slug,
  name: account.name,
  status: account.status === 'deleted' ? 'suspended' : account.status,
  created_at: account.createdAt.toISOString(),
  owners: account.owners,
  people: account.people,
  system_accounts: account.systemAccounts,
  open_invites: account.openInvites,
  limits: { max_members: account.limits.maxMembers, max_dockets: account.limits.maxDockets },
  suspended: account.suspended ? { at: account.suspended.at.toISOString(), by: account.suspended.by, reason: account.suspended.reason } : null,
})

/** Every account, the beta's limits, and how full the platform is. */
export async function operatorOverview() {
  const { router, maxOrgs } = getRuntime()
  const { accounts, live } = await router.withPlatform(async (tx) => ({ accounts: await operatorAccounts(tx), live: await countLiveOrgs(tx) }))
  return {
    accounts,
    defaults: { maxMembers: DEFAULT_ACCOUNT_LIMITS.maxMembers, maxDockets: DEFAULT_ACCOUNT_LIMITS.maxDockets },
    platform: { live, max: maxOrgs },
  }
}

/** What an operator changes about one account: each part left out stays as it is. */
export interface AccountChange {
  suspended?: boolean
  reason?: string | null
  maxMembers?: number | null
  maxDockets?: number | null
}

/**
 * Changes one account, in one transaction with its audit event in the
 * platform's log (`record`): a suspended account's own log is not served.
 */
export async function changeAccount(
  slug: string,
  change: AccountChange,
  operatorId: string,
  record: (tx: Tx, entry: { action: string; target: string[]; args: unknown }) => Promise<void>,
): Promise<OperatorAccount> {
  return getRuntime().router.withPlatform(async (tx) => {
    const account = await operatorAccount(tx, slug)
    if (!account) throw new TenancyError('not-found', 'No such account.')
    const args: Record<string, unknown> = {}
    if (change.suspended !== undefined) {
      const was = await setAccountSuspended(tx, { orgId: account.id, suspended: change.suspended, reason: change.reason ?? null, by: operatorId })
      args.status = { from: was, to: change.suspended ? 'suspended' : 'active' }
      if (change.suspended && change.reason) args.reason = change.reason
    }
    if (change.maxMembers !== undefined || change.maxDockets !== undefined) {
      const limits = await setAccountLimits(tx, {
        orgId: account.id,
        ...(change.maxMembers !== undefined ? { maxMembers: change.maxMembers } : {}),
        ...(change.maxDockets !== undefined ? { maxDockets: change.maxDockets } : {}),
      })
      args.limits = { from: account.limits, to: limits }
    }
    if (Object.keys(args).length === 0) throw new TenancyError('invalid', 'Say what to change: suspended, max_members or max_dockets.')
    await record(tx, { action: 'operator.account.update', target: [`org:${account.id}`, `slug:${account.slug}`], args })
    const changed = await operatorAccount(tx, slug)
    if (!changed) throw new Error('account vanished')
    return changed
  })
}
