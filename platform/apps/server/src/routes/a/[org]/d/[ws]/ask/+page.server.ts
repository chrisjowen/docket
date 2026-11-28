// SPDX-License-Identifier: AGPL-3.0-only
import type { RequestEvent } from '@sveltejs/kit'

import { askActions, loadAsk } from '$lib/server/ask-page'
import { authorise } from '$lib/server/request'
import { inWorkspace } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * Refuses a docket the member was not granted, or one in another account, as
 * every other docket route does (403), before the casebook's Ask looks at it.
 */
const mayRead = (event: RequestEvent) => inWorkspace(event, async ({ access }) => authorise(access, 'read'))

/** A docket's Chat tab: questions to this docket alone, and the chats that asked it alone. */
export const load: PageServerLoad = async (event) => {
  await mayRead(event)
  return loadAsk(event)
}

export const actions: Actions = {
  ask: async (event) => {
    await mayRead(event)
    return askActions.ask(event)
  },
  delete: async (event) => {
    await mayRead(event)
    return askActions.delete(event)
  },
}
