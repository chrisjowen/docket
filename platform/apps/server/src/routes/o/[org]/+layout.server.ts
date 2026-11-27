// SPDX-License-Identifier: AGPL-3.0-only
import { listWorkspaces } from '@docket/platform-canonical-store'
import { ACTIONS, can } from '@docket/platform-tenancy'

import { docketNumbers } from '$lib/docket'
import { orgAccess, permissionOn, seesDocket } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async (event) => {
  const access = await orgAccess(event)
  const { router, caps } = getRuntime()
  const [all, ai] = await Promise.all([router.withTenant(access.org.id, listWorkspaces), caps.status(access.org.id)])
  // Numbered across the org, so a docket keeps its number whoever is looking; listed only for those who may see it.
  const numbers = docketNumbers(all)
  const workspaces = all.filter((workspace) => seesDocket(access, workspace.id))
  return {
    org: { slug: access.org.slug, name: access.org.name },
    role: access.role,
    permissions: Object.fromEntries(ACTIONS.map((action) => [action, can(access.role, action)])) as Record<
      (typeof ACTIONS)[number],
      boolean
    >,
    workspaces: workspaces.map((workspace) => ({ slug: workspace.slug, name: workspace.name })),
    /**
     * The casebook's dockets the member may see, with their docket numbers, for the sidebar; a page's own
     * `workspaces` may stand in for the list above. `open` is false for one they see but were not granted.
     */
    dockets: workspaces.map((workspace) => ({
      slug: workspace.slug,
      name: workspace.name,
      docketNo: numbers.get(workspace.slug) ?? '',
      open: permissionOn(access, workspace.id) !== null,
    })),
    ai: { spentUsd: ai.spentUsd, capUsd: ai.capUsd, fraction: Number.isFinite(ai.fraction) ? ai.fraction : 1, warned: ai.warnedAt !== null },
  }
}
