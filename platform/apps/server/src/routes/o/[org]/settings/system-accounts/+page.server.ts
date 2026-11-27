// SPDX-License-Identifier: AGPL-3.0-only
import { TenancyError, assignableRoles, createServiceAccount, isRole, listSystemAccounts, tokenNotices } from '@docket/platform-tenancy'
import { redirect } from '@sveltejs/kit'

import { authorise, orgAccess } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { Actions, PageServerLoad } from './$types'
import { ROLE_LABELS, manage } from '$lib/server/system-accounts'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  authorise(access, 'members.manage')
  const { accounts, notices } = await getRuntime().router.withPlatform(async (tx) => ({
    accounts: await listSystemAccounts(tx, access.org.id),
    notices: await tokenNotices(tx, access.org.id),
  }))
  return {
    owner: access.can('org.administer'),
    roles: assignableRoles(access.role)
      .filter((role) => role !== 'owner')
      .map((role) => ({ role, label: ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role })),
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      description: account.description,
      role: account.role,
      access: ROLE_LABELS[account.role as keyof typeof ROLE_LABELS] ?? account.role,
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
  create: async (event) => {
    const created = await manage(event, async (tx, { access, userId, form }) => {
      const role = form.get('role')
      if (!isRole(role)) throw new TenancyError('invalid', 'Choose what it may do.')
      const account = await createServiceAccount(tx, {
        orgId: access.org.id,
        name: String(form.get('name') ?? '').trim().toLowerCase(),
        description: String(form.get('description') ?? '').trim().slice(0, 200) || null,
        role,
        actorId: userId,
        actorRole: access.role,
      })
      return {
        action: 'system-accounts.create',
        target: [`user:${account.id}`],
        args: { name: account.login, role },
        flash: `System account ${account.login} created. Issue it a token below.`,
        id: account.id,
      }
    })
    if ('id' in created && typeof created.id === 'string') redirect(303, `/o/${event.params.org}/settings/system-accounts/${created.id}?created=1`)
    return created
  },
}
