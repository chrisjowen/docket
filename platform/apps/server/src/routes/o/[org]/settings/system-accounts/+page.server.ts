// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, createServiceAccount, listGrants, listSystemAccounts, tokenNotices } from '@docket/platform-tenancy'
import { error, redirect } from '@sveltejs/kit'

import { docketNames, giveChange, grantView, placesToGive, rolesFor } from '$lib/server/grants'
import { orgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { accessSummary, manage, mayManageSystemAccounts } from '$lib/server/system-accounts'

import type { Actions, PageServerLoad } from './$types'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  if (!mayManageSystemAccounts(access)) error(403, 'You do not have access to that.')
  const dockets = await docketNames(access.org.id)
  const { accounts, notices, grants } = await getRuntime().router.withPlatform(async (tx) => ({
    accounts: await listSystemAccounts(tx, access.org.id),
    notices: await tokenNotices(tx, access.org.id),
    grants: await listGrants(tx, access.org.id),
  }))
  const grantsOf = (id: string) =>
    grants.filter((grant) => grant.who.kind === 'user' && grant.who.id === id).map((grant) => grantView(grant, access.principal, dockets, access.org.name))
  return {
    roles: await rolesFor(access.org.id),
    places: placesToGive(access, dockets, 'service'),
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      description: account.description,
      access: accessSummary(grantsOf(account.id)),
      managed: account.managed,
      createdAt: iso(account.createdAt),
      createdBy: account.createdByLogin,
      liveTokens: account.liveTokens,
      lastUsedAt: iso(account.lastUsedAt),
      nextExpiry: iso(account.nextExpiry),
    })),
    notices: notices.map((notice) => ({ ...notice, expiresAt: notice.expiresAt.toISOString() })),
  }
}

export const actions: Actions = {
  /** Makes a system account and gives it its first grant, in one transaction: a role on a place the member manages. */
  create: async (event) => {
    const created = await manage(event, async (tx, { access, userId, form }) => {
      const account = await createServiceAccount(tx, {
        orgId: access.org.id,
        name: String(form.get('name') ?? '').trim().toLowerCase(),
        description: String(form.get('description') ?? '').trim().slice(0, 200) || null,
        actorId: userId,
        actor: access.principal,
      })
      const dockets = await docketNames(access.org.id)
      const given = await giveChange(tx, { access, userId, form, dockets }, { kind: 'user', id: account.id }).catch((cause: unknown) => {
        throw cause instanceof TenancyError ? cause : new TenancyError('invalid', 'Choose what it may do.')
      })
      return {
        action: 'system-accounts.create',
        target: [`user:${account.id}`, ...given.target],
        args: { name: account.login, grant: given.args },
        flash: `System account ${account.login} created. Issue it a token below.`,
        id: account.id,
      }
    })
    if ('id' in created && typeof created.id === 'string') redirect(303, `/o/${event.params.org}/settings/system-accounts/${created.id}?created=1`)
    return created
  },
}
