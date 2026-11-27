// SPDX-License-Identifier: AGPL-3.0-only
import { countDocuments, listIngests, listWorkspaces } from '@docket/platform-canonical-store'
import { listMembers } from '@docket/platform-tenancy'

import { filingsByMonth, standingOf } from '$lib/docket'
import { orgAccess, permissionOn } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { inOrg } from '$lib/server/workspace'

import type { PageServerLoad } from './$types'

/** Filings read per docket for its sparkline and standing: the newest, which is plenty for twelve months of a casebook. */
const FILINGS_READ = 500

/**
 * The casebook: every docket of the org's the member reaches, each with its
 * documents, its filings (activity log entries) month by month and when it
 * last had one.
 */
export const load: PageServerLoad = async (event) => {
  const access = await orgAccess(event)
  const now = new Date()
  const [dockets, members] = await Promise.all([
    inOrg(access, async (ctx) => {
      const rows = []
      for (const workspace of (await listWorkspaces(ctx.tx)).filter((each) => permissionOn(access, each.id) !== null)) {
        const filings = await listIngests(ctx, { workspaceId: workspace.id, limit: FILINGS_READ, detail: false })
        const last = filings[0]?.createdAt ?? null
        rows.push({
          slug: workspace.slug,
          documents: await countDocuments(ctx.tx, workspace.id),
          filings: filingsByMonth(
            filings.map((filing) => filing.createdAt),
            now,
          ),
          standing: standingOf(last, now),
          updatedAt: (last ?? workspace.createdAt).toISOString(),
        })
      }
      return rows
    }),
    getRuntime().router.withPlatform((tx) => listMembers(tx, access.org.id)),
  ])
  return { casebook: dockets, members: members.length }
}
