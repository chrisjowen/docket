// SPDX-License-Identifier: AGPL-3.0-only
import { listWorkspaces } from '@docket/platform-canonical-store'
import { ACCOUNT, CAPABILITIES, isAccountAdmin, tokenNotices } from '@docket/platform-tenancy'

import { docketNumbers } from '$lib/docket'
import { accountRoles } from '$lib/server/members'
import { orgAccess, readsDocket, seesDocket } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async (event) => {
  const access = await orgAccess(event)
  const { router, caps } = getRuntime()
  const [all, ai, notices, role] = await Promise.all([
    router.withTenant(access.org.id, listWorkspaces),
    caps.status(access.org.id),
    // System accounts' token notices go to the account's owners: there is no steward (tenancy v2 §3.3).
    access.owner ? router.withPlatform((tx) => tokenNotices(tx, access.org.id)) : Promise.resolve([]),
    router.withPlatform(async (tx) => {
      const me = { id: access.principal.userId, owner: access.owner, guest: access.principal.guest }
      return (await accountRoles(tx, access.org.id, [me])).get(me.id) ?? ''
    }),
  ])
  const onAccount = access.capsAt(ACCOUNT)
  // Numbered across the org, so a docket keeps its number whoever is looking; listed only for those who may see it.
  const numbers = docketNumbers(all)
  const workspaces = all.filter((workspace) => seesDocket(access, workspace.id))
  return {
    org: { slug: access.org.slug, name: access.org.name },
    /** What the member is across the account, in a few words: Owner, or their role there. */
    role,
    /** What they may do on the whole account, capability by capability (tenancy v2 §3.1). */
    permissions: Object.fromEntries(CAPABILITIES.map((cap) => [cap, onAccount.has(cap)])) as Record<(typeof CAPABILITIES)[number], boolean>,
    owner: access.owner,
    /** Admin on the whole account: may change the account's roles. */
    accountAdmin: isAccountAdmin(access.principal),
    /** Manages access, or system accounts, somewhere: the Users page and Settings › System accounts show them where. */
    managesAccess: access.canAnywhere('access'),
    managesSystemAccounts: access.canAnywhere('system'),
    workspaces: workspaces.map((workspace) => ({ slug: workspace.slug, name: workspace.name })),
    /**
     * The casebook's dockets the member may see, with their docket numbers, for the sidebar; a page's own
     * `workspaces` may stand in for the list above. `open` is false for one they see but may not read.
     */
    dockets: workspaces.map((workspace) => ({
      slug: workspace.slug,
      name: workspace.name,
      docketNo: numbers.get(workspace.slug) ?? '',
      open: readsDocket(access, workspace.id),
    })),
    tokenNotices: { expiring: notices.filter((notice) => !notice.expired).length, expired: notices.filter((notice) => notice.expired).length },
    ai: { spentUsd: ai.spentUsd, capUsd: ai.capUsd, fraction: Number.isFinite(ai.fraction) ? ai.fraction : 1, warned: ai.warnedAt !== null },
  }
}
