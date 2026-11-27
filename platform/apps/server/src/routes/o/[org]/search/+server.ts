// SPDX-License-Identifier: AGPL-3.0-only
import { json } from '@sveltejs/kit'

import { chosenWorkspaces } from '$lib/ask/model'
import { searchAcross } from '$lib/server/ask'
import { askDeps, orgWorkspaces } from '$lib/server/ask-runtime'
import { authorise, orgAccess, requireUser } from '$lib/server/request'

import type { RequestHandler } from './$types'

/** The longest query the command menu sends. */
const MAX_QUERY = 200
/** Results of each kind the menu is sent; it lists the first few. */
const SENT = 5

/**
 * The command menu's search (⌘K): the same direct search as Ask's, no AI,
 * over the dockets named by `ws` (every one of the org's when none is), with
 * only the first few of each kind of result. The page asks as the member, so
 * the search is kept in their query log like any other.
 */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authorise(access, 'graph.read')
  const user = requireUser(event)
  const query = (event.url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY)
  const all = await orgWorkspaces(access)
  const named = event.url.searchParams.getAll('ws')
  const workspaces = named.length ? chosenWorkspaces(all, named) : all
  if (!query || workspaces.length === 0) return json({ records: [], groups: { notes: [], memory: [], exhibits: [], entries: [] }, slots: {} })
  const found = await searchAcross(askDeps(access, user.id), workspaces, query, { types: [], tags: [] })
  return json(
    {
      records: found.hits.slice(0, SENT),
      groups: {
        notes: found.groups.notes.slice(0, SENT),
        memory: found.groups.memory.slice(0, SENT),
        exhibits: found.groups.exhibits.slice(0, SENT),
        entries: found.groups.entries.slice(0, SENT),
      },
      slots: found.slots,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
