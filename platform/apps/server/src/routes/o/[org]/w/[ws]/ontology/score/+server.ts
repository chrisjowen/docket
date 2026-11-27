// SPDX-License-Identifier: AGPL-3.0-only
import { error, json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { scoreSample, text } from '$lib/server/sample-score'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** The Policies tab's "What would this evidence score?" for a workspace's draft (`scoreSample`). Writes nothing. */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml, source, about?, instance?, claims?, locator?, record? }.')
  const yaml = body.yaml
  const source = text(body.source, 64)
  if (!source) error(400, 'Choose a source.')
  return inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, 'ontology.propose')
      return json(await scoreSample(ctx, workspace.id, body, yaml, source))
    },
    { api: true },
  )
}
