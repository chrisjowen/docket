// SPDX-License-Identifier: AGPL-3.0-only
import { json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { syncLive } from '$lib/server/sync-status'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * Settings → Sync's standing as the worker moves it, for the open page to
 * read again: each store's last sync and failures, the changes waiting, and
 * the recent passes. It opens no document.
 */
export const GET: RequestHandler = (event) =>
  inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, 'read')
      return json(await syncLive(ctx.tx, workspace.id), { headers: { 'cache-control': 'no-store' } })
    },
    { api: true },
  )
