// SPDX-License-Identifier: AGPL-3.0-only
import { askActions, loadAsk } from '$lib/server/ask-page'

import type { Actions, PageServerLoad } from './$types'

/** The casebook's Ask: questions to the dockets the scope chip chooses. */
export const load: PageServerLoad = loadAsk
export const actions: Actions = askActions
