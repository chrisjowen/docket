// SPDX-License-Identifier: AGPL-3.0-only
import { listProposals } from '@docket/platform-canonical-store'
import { error, json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { proposalView } from '$lib/server/trust'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

const STATUSES = ['pending', 'accepted', 'rejected'] as const

/**
 * The workspace's supersede proposals, newest first: pending ones scored now,
 * with what would carry them, and decided ones as they were decided.
 * `?status=pending` lists one state's. Any member reads them.
 */
export const GET: RequestHandler = async (event) => {
  const status = event.url.searchParams.get('status')
  if (status !== null && !(STATUSES as readonly string[]).includes(status)) error(400, `status is ${STATUSES.join(', ')}.`)
  return json(
    await inWorkspace(
      event,
      async ({ access, workspace, ctx }) => {
        authorise(access, 'read')
        const listed = await listProposals(ctx, workspace.id, status ? { status: status as (typeof STATUSES)[number] } : {})
        return { workspace: workspace.slug, proposals: listed.map(proposalView) }
      },
      { api: true },
    ),
  )
}
