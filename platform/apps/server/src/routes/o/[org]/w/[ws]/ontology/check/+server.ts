// SPDX-License-Identifier: AGPL-3.0-only
import { MigrationInvalid, OntologyInvalid, checkDraft, migrationSteps } from '@docket/platform-ontology-service'
import { error, json } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { inWorkspace, publisherOf } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/**
 * The editor's dry run (§13.5): re-validates every document against the
 * draft text, with the migration applied, and writes nothing.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as { yaml?: unknown; migration?: unknown } | null
  if (!body || typeof body.yaml !== 'string') error(400, 'Send { yaml, migration? }.')
  const yaml = body.yaml
  const migration = migrationSteps(body.migration)
  if (!migration) error(400, 'The migration is not a list.')
  const { login } = publisherOf(event)
  return inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, 'propose')
      try {
        return json({ ok: true, check: await checkDraft(ctx, workspace.id, yaml, { migration, login }) })
      } catch (caught) {
        if (caught instanceof OntologyInvalid) return json({ ok: false, invalid: caught.diagnostics })
        if (caught instanceof MigrationInvalid) return json({ ok: false, migration: caught.problems })
        throw caught
      }
    },
    { api: true },
  )
}
