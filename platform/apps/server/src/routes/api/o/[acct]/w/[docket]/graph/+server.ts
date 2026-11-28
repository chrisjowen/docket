// SPDX-License-Identifier: AGPL-3.0-only
import { workspaceGraph } from '@docket/platform-canonical-store'
import { json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * The workspace's graph in docket-ui's `UiGraph` shape (what `docket open`
 * serves as `GET /api/graph`), read from its canonical documents, with how
 * far each projection lags. 404 outside the org (§5.5); the hook audits the call.
 */
export const GET: RequestHandler = async (event) =>
  json(
    await inWorkspace(
      event,
      async ({ access, workspace, ctx }) => {
        authorise(access, 'read')
        return workspaceGraph(ctx, workspace, { root: `/a/${access.org.slug}/d/${workspace.slug}` })
      },
      { api: true },
    ),
  )
