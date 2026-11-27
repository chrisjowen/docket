// SPDX-License-Identifier: AGPL-3.0-only
import { convertOntologyText } from '@chrisjowen/docket'
import { error, json } from '@sveltejs/kit'

import { authorise, orgAccess } from '$lib/server/request'

import type { RequestHandler } from './$types'

/** Rewrites a draft's legacy evidence settings as sources and policies, as the workspace editor's convert does. Writes nothing. */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as { yaml?: unknown } | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml }.')
  const yaml = body.yaml
  authorise(await orgAccess(event, { api: true }), 'ontology.publish')
  try {
    return json({ ok: true, ...convertOntologyText(yaml) })
  } catch (caught) {
    return json({ ok: false, problem: caught instanceof Error ? caught.message : 'The draft is not an ontology.' })
  }
}
