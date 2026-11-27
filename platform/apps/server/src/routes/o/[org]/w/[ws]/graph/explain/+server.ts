// SPDX-License-Identifier: AGPL-3.0-only
import { explainEntity, explainLink, orgTrust, readWorkspace, trustModel } from '@docket/platform-canonical-store'
import { error, json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * A record's "Why 0.93" (trust design §6.2): its confidence explained,
 * observation by observation, by the published ontology's policies over what
 * the org attests - or, given `rel` and `target`, one of its links'. The case
 * file asks for it when it opens; the graph itself carries only the band and
 * a line per source.
 */
export const GET: RequestHandler = async (event) => {
  const id = event.url.searchParams.get('id')?.trim()
  const rel = event.url.searchParams.get('rel')?.trim()
  const target = event.url.searchParams.get('target')?.trim()
  if (!id) error(400, 'Name the record: ?id=<id>.')
  return inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, 'read')
      const read = await readWorkspace(ctx, workspace.id)
      const entity = read.entities.find((each) => each.id === id)
      if (!entity) error(404, 'No such record.')
      const model = trustModel(read.ontology ?? { version: 1, resourceTypes: {}, relationships: {} }, await orgTrust(ctx))
      if (rel || target) {
        const link = entity.links.find((each) => each.rel === rel && each.target === target)
        if (!link) error(404, 'No such link.')
        return json({ explained: explainLink(model, link.rel, link.evidence) })
      }
      return json({ explained: explainEntity(model, entity) })
    },
    { api: true },
  )
}
