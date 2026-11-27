// SPDX-License-Identifier: AGPL-3.0-only
import { docketDraftById } from '@docket/platform-ontology-service'
import { error, json } from '@sveltejs/kit'

import { authorise, orgAccess } from '$lib/server/request'
import { scoreSample, text } from '$lib/server/sample-score'
import { inOrg, publisherOf } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** The Policies tab's "What would this evidence score?" for a docket not made yet: no records to add it to. Writes nothing. */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml, source, about?, instance?, claims?, locator? }.')
  const yaml = body.yaml
  const source = text(body.source, 64)
  if (!source) error(400, 'Choose a source.')
  const access = await orgAccess(event, { api: true })
  authorise(access, 'create')
  const { actor } = publisherOf(event)
  return inOrg(access, async (ctx) => {
    if (!(await docketDraftById(ctx.tx, event.params.id, actor))) error(404, 'Not found')
    return json(await scoreSample(ctx, null, body, yaml, source))
  })
}
