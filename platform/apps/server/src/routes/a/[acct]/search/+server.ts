// SPDX-License-Identifier: AGPL-3.0-only
import { json } from '@sveltejs/kit'

import { commandSearch } from '$lib/server/shell'
import { authoriseAnywhere, orgAccess, requireUser } from '$lib/server/request'

import type { RequestHandler } from './$types'

/**
 * The command menu's search (⌘K), at its old address: the same as
 * `GET /api/v1/accounts/{acct}/search` (`accounts.search`), which the menu now calls.
 */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authoriseAnywhere(access, 'read')
  const user = requireUser(event)
  const found = await commandSearch(access, user.id, event.url.searchParams.get('q') ?? '', event.url.searchParams.getAll('ws'))
  return json(found, { headers: { 'cache-control': 'no-store' } })
}
