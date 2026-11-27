// SPDX-License-Identifier: AGPL-3.0-only
import { convertOntologyText } from '@chrisjowen/docket'
import { error, json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * Rewrites a draft's legacy evidence settings - an `evidence:` block, a
 * type's or relationship's `confidence:` numbers - as sources and policies
 * that score exactly as they did, every other line kept (docket's
 * `convertOntologyText`). Writes nothing: the editor puts the text in the draft.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as { yaml?: unknown } | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml }.')
  const yaml = body.yaml
  return inWorkspace(
    event,
    async ({ access }) => {
      authorise(access, 'propose')
      try {
        return json({ ok: true, ...convertOntologyText(yaml) })
      } catch (caught) {
        return json({ ok: false, problem: caught instanceof Error ? caught.message : 'The draft is not an ontology.' })
      }
    },
    { api: true },
  )
}
