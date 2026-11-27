// SPDX-License-Identifier: AGPL-3.0-only
import { MigrationInvalid, OntologyInvalid, checkNewDocket, docketDraftById, migrationSteps } from '@docket/platform-ontology-service'
import { error, json } from '@sveltejs/kit'

import { authorise, orgAccess } from '$lib/server/request'
import { inOrg, publisherOf } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** The editor's dry run for a docket not made yet: the draft against no documents and no head. Writes nothing. */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as { yaml?: unknown; migration?: unknown } | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml, migration? }.')
  const yaml = body.yaml
  const migration = migrationSteps(body.migration)
  if (!migration) error(400, 'The migration is not a list.')
  const access = await orgAccess(event, { api: true })
  authorise(access, 'create')
  const { actor, login } = publisherOf(event)
  return inOrg(access, async (ctx) => {
    if (!(await docketDraftById(ctx.tx, event.params.id, actor))) error(404, 'Not found')
    try {
      return json({ ok: true, check: await checkNewDocket(ctx, yaml, { migration, login }) })
    } catch (caught) {
      if (caught instanceof OntologyInvalid) return json({ ok: false, invalid: caught.diagnostics })
      if (caught instanceof MigrationInvalid) return json({ ok: false, migration: caught.problems })
      throw caught
    }
  })
}
