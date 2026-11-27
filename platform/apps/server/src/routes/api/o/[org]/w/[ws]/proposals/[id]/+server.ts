// SPDX-License-Identifier: AGPL-3.0-only
import { confirmProposal, listProposals, overrideProposal, proposalById, rejectProposal } from '@docket/platform-canonical-store'
import { error, json } from '@sveltejs/kit'

import { webWriter } from '$lib/server/capture'
import { authorise, recordAudit } from '$lib/server/request'
import { bodyOf, decisionAnswer, proposalView } from '$lib/server/trust'
import { inWorkspace } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

/** One supersede proposal, by its id or a prefix of at least eight characters. */
export const GET: RequestHandler = async (event) =>
  json(
    await inWorkspace(
      event,
      async ({ access, workspace, ctx }) => {
        authorise(access, 'graph.read')
        const found = await proposalById(ctx, workspace.id, event.params.id)
        if (!found) error(404, 'No such proposal.')
        const listed = (await listProposals(ctx, workspace.id, { limit: 500 })).find((each) => each.supersession.id === found.id)
        return proposalView(listed ?? { supersession: found, score: found.score, threshold: found.threshold, stale: false, carry: [] })
      },
      { api: true },
    ),
  )

const DECISIONS = ['confirm', 'reject', 'accept'] as const

/**
 * Decides on a pending proposal, as the signed-in member:
 *
 * - `{ "decision": "confirm", "note"? }`: first-hand evidence from you, scored
 *   like any other - it may carry the proposal, or not. Editors and above.
 * - `{ "decision": "reject", "reason" }`: the older record stays current, both
 *   kept. Editors and above.
 * - `{ "decision": "accept", "reason" }`: accepted regardless of its score,
 *   recorded as an override. Owners and admins.
 */
export const POST: RequestHandler = async (event) => {
  const body = await bodyOf(event)
  const decision = body.decision
  if (!(DECISIONS as readonly unknown[]).includes(decision)) error(400, `decision is ${DECISIONS.join(', ')}.`)
  const words = (key: 'note' | 'reason') => (typeof body[key] === 'string' ? (body[key] as string) : '')
  const result = await inWorkspace(
    event,
    async ({ access, workspace, ctx }) => {
      authorise(access, decision === 'accept' ? 'proposals.override' : 'knowledge.write')
      const writer = webWriter(event, workspace.id)
      const input = { supersession: event.params.id }
      const done =
        decision === 'confirm'
          ? await confirmProposal(ctx, writer, { ...input, note: words('note') })
          : decision === 'reject'
            ? await rejectProposal(ctx, writer, { ...input, reason: words('reason') })
            : await overrideProposal(ctx, writer, { ...input, reason: words('reason') })
      const refused = done.diagnostics.some((d) => d.severity === 'error')
      await recordAudit(ctx.tx, event, {
        action: `proposals.${decision as string}`,
        orgId: access.org.id,
        workspaceId: workspace.id,
        outcome: refused ? 'invalid' : 'ok',
        target: done.proposal ? [done.proposal.resource, done.proposal.supersededBy] : [event.params.id.slice(0, 100)],
        args: { proposal: event.params.id.slice(0, 100) },
      })
      return done
    },
    { api: true },
  )
  return decisionAnswer(result)
}
