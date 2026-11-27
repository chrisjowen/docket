// SPDX-License-Identifier: AGPL-3.0-only
import { exportYaml, headOf, versionByNumber } from '@docket/platform-ontology-service'
import { error } from '@sveltejs/kit'

import { authorise } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** The published head, or `?v=<n>`, as `entities.yaml` with its docket-cloud header (§13.4). */
export const GET: RequestHandler = async (event) => {
  const v = event.url.searchParams.get('v')
  return inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'graph.read')
    const version = v ? await versionByNumber(ctx.tx, workspace.id, Number(v)) : await headOf(ctx.tx, workspace.id)
    if (!version?.number) error(404, 'Not found')
    const body = exportYaml({
      org: access.org.slug,
      workspace: workspace.slug,
      number: version.number,
      hash: version.yamlHash,
      yaml: version.yaml,
    })
    return new Response(body, {
      headers: {
        'content-type': 'application/yaml; charset=utf-8',
        'content-disposition': `attachment; filename="entities.yaml"`,
        'cache-control': 'no-store',
      },
    })
  })
}
