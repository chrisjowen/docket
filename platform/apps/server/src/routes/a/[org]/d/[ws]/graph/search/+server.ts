// SPDX-License-Identifier: AGPL-3.0-only
import { json } from '@sveltejs/kit'

import { searchAcross } from '$lib/server/ask'
import { askDeps } from '$lib/server/ask-runtime'
import { authorise, requireUser } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** The longest query the network's query box sends. */
const MAX_QUERY = 200

/**
 * The network's query: the same direct search as Ask's and the command
 * menu's, no AI, over this docket alone, by text and optionally one type and
 * one tag. It answers with the matching records' ids, best first, and what
 * the search could not do; the board draws those and their links. The page
 * asks as the member, so the search is kept in their query log.
 */
export const GET: RequestHandler = async (event) => {
  const { access, workspace } = await inWorkspace(
    event,
    async ({ access, workspace }) => {
      authorise(access, 'read')
      return { access, workspace }
    },
    { api: true },
  )
  const user = requireUser(event)
  const params = event.url.searchParams
  const query = (params.get('q') ?? '').trim().slice(0, MAX_QUERY)
  const one = (name: string) => (params.get(name) ?? '').trim().slice(0, MAX_QUERY)
  const filters = { types: [one('type')].filter(Boolean), tags: [one('tag')].filter(Boolean) }
  const found = await searchAcross(askDeps(access, user.id), [{ id: workspace.id, slug: workspace.slug, name: workspace.name }], query, filters)
  return json({ matched: found.hits.map((hit) => hit.id), notes: found.notes.map((note) => note.message) }, { headers: { 'cache-control': 'no-store' } })
}
