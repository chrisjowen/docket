// SPDX-License-Identifier: AGPL-3.0-only
import { supersedeAnswer } from '@chrisjowen/docket/mcp/surface'
import {
  confirmProposal,
  hasErrors,
  listProposals,
  overrideProposal,
  proposalDetail,
  readWorkspace,
  rejectProposal,
  type ProposalDetail,
} from '@docket/platform-canonical-store'
import { error, fail, type RequestEvent } from '@sveltejs/kit'

import { webWriter } from './capture'
import { authorise, recordAudit } from './request'
import { proposalView } from './trust'
import { formText, inWorkspace } from './workspace'

/**
 * The Proposals queue (trust design §6.3): replacements awaiting proof. A
 * proposal is pending until its evidence clears the bar for the record it
 * would replace; a member confirms it (evidence like any other, scored), turns
 * it down, or - an owner or admin - accepts it regardless.
 */

export const STATUSES = ['pending', 'accepted', 'rejected', 'all'] as const
export type StatusFilter = (typeof STATUSES)[number]

/** A record as the queue names it. */
interface Named {
  title: string
  type: string
}

/** The detail pane: the proposal, its evidence explained, what a confirmation is worth, and what an agent was told. */
function detailOf(detail: ProposalDetail) {
  const view = proposalView(detail)
  const answer =
    detail.supersession.status === 'rejected'
      ? null
      : supersedeAnswer({ id: view.resource, by: view.by }, null, {
          changed: true,
          supersession: { supersededBy: view.by, validUntil: view.validUntil },
          proposal: { id: view.id, status: view.status, score: view.score ?? 0, threshold: view.threshold ?? 0, carry: view.carry },
          diagnostics: [],
        })
  return {
    ...view,
    type: detail.type,
    explained: detail.explained,
    confirmed: detail.confirmed,
    updatedAt: detail.supersession.updatedAt.toISOString(),
    // As docket_supersede answers it with the proposal as it stands now.
    answer: answer ? { text: answer.content.map((part) => part.text).join('\n'), structured: answer.structuredContent ?? null } : null,
  }
}

export async function loadProposals(event: RequestEvent, id: string | null) {
  const status = (STATUSES as readonly string[]).includes(event.url.searchParams.get('status') ?? '')
    ? (event.url.searchParams.get('status') as StatusFilter)
    : id
      ? 'all'
      : 'pending'
  return inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    const all = await listProposals(ctx, workspace.id, { limit: 500 })
    const counts = { pending: 0, accepted: 0, rejected: 0, all: all.length }
    for (const each of all) counts[each.supersession.status] += 1
    const shown = status === 'all' ? all : all.filter((each) => each.supersession.status === status)
    const records = new Map<string, Named>((await readWorkspace(ctx, workspace.id)).entities.map((entity) => [entity.id, { title: entity.title, type: entity.type }]))
    const chosen = id ?? shown[0]?.supersession.id ?? null
    const canDecide = access.can('write')
    const detail = chosen ? await proposalDetail(ctx, workspace.id, chosen, canDecide && event.locals.user ? { viewer: webWriter(event, workspace.id) } : {}) : null
    if (id && !detail) error(404, 'No such proposal.')
    const named = (record: string) => records.get(record) ?? null
    return {
      status,
      counts,
      queue: shown.map((each) => ({
        id: each.supersession.id,
        status: each.supersession.status,
        resource: each.supersession.resourceId,
        by: each.supersession.supersededBy,
        score: each.score,
        threshold: each.threshold,
        stale: each.stale,
        recordedAt: each.supersession.recordedAt.toISOString(),
        byTitle: named(each.supersession.supersededBy)?.title ?? null,
        resourceTitle: named(each.supersession.resourceId)?.title ?? null,
      })),
      detail: detail ? { ...detailOf(detail), old: named(detail.supersession.resourceId), new: named(detail.supersession.supersededBy) } : null,
      canDecide,
      canOverride: access.can('decide'),
    }
  })
}

const DECISIONS = { confirm: 'write', reject: 'write', accept: 'decide' } as const

/** A decision from the proposal's page, as the signed-in member: the same writes the API makes, audited alike. */
export async function decide(event: RequestEvent, decision: keyof typeof DECISIONS) {
  const form = await event.request.formData()
  const id = event.params.id ?? ''
  const words = formText(form, decision === 'confirm' ? 'note' : 'reason').trim()
  if (decision !== 'confirm' && !words) return fail(400, { decision, problem: decision === 'reject' ? 'Say why it is rejected.' : 'Say why it is accepted regardless.' })
  return inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, DECISIONS[decision])
    const writer = webWriter(event, workspace.id)
    const input = { supersession: id }
    const done =
      decision === 'confirm'
        ? await confirmProposal(ctx, writer, { ...input, note: words })
        : decision === 'reject'
          ? await rejectProposal(ctx, writer, { ...input, reason: words })
          : await overrideProposal(ctx, writer, { ...input, reason: words })
    const refused = hasErrors(done.diagnostics)
    await recordAudit(ctx.tx, event, {
      action: `proposals.${decision}`,
      orgId: access.org.id,
      workspaceId: workspace.id,
      outcome: refused ? 'invalid' : 'ok',
      target: done.proposal ? [done.proposal.resource, done.proposal.supersededBy] : [id.slice(0, 100)],
      args: { proposal: id.slice(0, 100) },
    })
    if (refused) return fail(400, { decision, problem: done.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join(' ') })
    const outcome = done.proposal
    const flash =
      decision === 'reject'
        ? 'Rejected. The older record stays current; both are kept.'
        : decision === 'accept'
          ? 'Accepted regardless, recorded as an override. Search now answers with the replacement.'
          : outcome?.status === 'accepted'
            ? `Confirmed, and that carried it: ${outcome.score.toFixed(2)} clears ${outcome.threshold.toFixed(2)}. Search now answers with the replacement.`
            : `Confirmed. It now scores ${outcome?.score.toFixed(2) ?? '?'} of the ${outcome?.threshold.toFixed(2) ?? '?'} it needs.`
    return { decision, flash }
  })
}
