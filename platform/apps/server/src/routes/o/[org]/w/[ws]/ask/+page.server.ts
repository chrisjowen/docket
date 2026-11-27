// SPDX-License-Identifier: AGPL-3.0-only
import { askActions, loadAsk } from '$lib/server/ask-page'

import type { Actions, PageServerLoad } from './$types'

/** A docket's Chat tab: questions to this docket alone, and the chats that asked it alone. */
export const load: PageServerLoad = loadAsk
export const actions: Actions = askActions
