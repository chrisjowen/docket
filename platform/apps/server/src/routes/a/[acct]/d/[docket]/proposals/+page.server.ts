// SPDX-License-Identifier: AGPL-3.0-only
import { loadProposals } from '$lib/server/proposals'

import type { PageServerLoad } from './$types'

/** The Proposals queue, opened on the first in its filter. */
export const load: PageServerLoad = (event) => loadProposals(event, null)
