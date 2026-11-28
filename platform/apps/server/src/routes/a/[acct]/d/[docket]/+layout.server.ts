// SPDX-License-Identifier: AGPL-3.0-only
import { docketFacts, docketHeader } from '$lib/server/shell'
import { inWorkspace } from '$lib/server/workspace'

import type { LayoutServerLoad } from './$types'

/** The docket's header: what `dockets.get` and `dockets.summary` answer too (`docketHeader`). */
export const load: LayoutServerLoad = async (event) => {
  const { access, workspace, facts } = await inWorkspace(event, async ({ access, workspace, ctx }) => ({ access, workspace, facts: await docketFacts(ctx, workspace) }))
  return docketHeader({ access, workspace, facts, caps: access.caps })
}
