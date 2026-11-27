// SPDX-License-Identifier: AGPL-3.0-only
import { decide, loadProposals } from '$lib/server/proposals'

import type { Actions, PageServerLoad } from './$types'

/** One proposal, beside the queue. */
export const load: PageServerLoad = (event) => loadProposals(event, event.params.id)

export const actions: Actions = {
  /** First-hand evidence from you: scored like any other, it may carry the proposal or not. */
  confirm: (event) => decide(event, 'confirm'),
  /** The older record stays current; both are kept. */
  reject: (event) => decide(event, 'reject'),
  /** Accepted regardless of its score, recorded as an override: owners and admins. */
  accept: (event) => decide(event, 'accept'),
}
