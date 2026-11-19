/**
 * Supersede proposals. `docket_supersede` is fire and forget: it records the
 * replacement at once, as a proposal scored by the ontology's policies like
 * any other evidence - about `supersedes`, or about the replaced record's
 * type. A proposal whose score clears the bar for that type (`trust.accept`)
 * is accepted and the older record goes out of date, as a supersession always
 * did; one that does not stays pending, the older record current, until more
 * evidence, a confirmation, a policy or a person's role carries it. Accepted
 * stays accepted. Nothing pending is ever dropped: after thirty days with no
 * change it is flagged stale.
 */

import { explain, observationConfidence, type ConfidenceModel, type Subject } from '../evidence/confidence.js'
import type { MemoryEvidence } from '../model/index.js'

export type ProposalStatus = 'pending' | 'accepted' | 'rejected'

/** Days a pending proposal goes unchanged before it is flagged stale. */
export const STALE_AFTER_DAYS = 30

/** What a proposal's evidence scores against its bar. */
export interface ProposalScore {
  score: number
  /** The bar it needs: `trust.accept` for the replaced record's type, else `trust.accept.default`. */
  threshold: number
  clears: boolean
}

/** The subject a proposal replacing a record of `type` is scored as. */
export const proposalSubject = (type: string): Subject => ({ kind: 'supersession', type })

/** The bar a proposal replacing a record of `type` must clear. */
export const thresholdFor = (model: Pick<ConfidenceModel, 'accept'>, type: string | undefined): number =>
  (type !== undefined ? model.accept[type] : undefined) ?? model.accept.default ?? 0.75

/** A proposal's score: its own evidence only - a replacement being true is not the same as it replacing something. */
export const scoreProposal = (model: ConfidenceModel, type: string | undefined, evidence: readonly MemoryEvidence[]): ProposalScore => {
  const threshold = thresholdFor(model, type)
  const score = explain(model, proposalSubject(type ?? ''), evidence).confidence
  return { score, threshold, clears: score >= threshold }
}

/**
 * What would carry a pending proposal: the score policies a single further
 * observation could be priced by that would take it over its bar, with the
 * score it would reach, best first. Empty when one observation would not do.
 */
export const wouldCarry = (
  model: ConfidenceModel,
  type: string | undefined,
  current: ProposalScore
): { policy: string; source: string; reaches: number }[] => {
  const subject = proposalSubject(type ?? '')
  const out = new Map<string, { policy: string; source: string; reaches: number }>()
  for (const policy of model.policies) {
    if (policy.score === undefined) continue
    if (policy.when.about !== undefined && policy.when.about !== 'supersedes' && policy.when.about !== type) continue
    // A policy with conditions is priced by its own score; one without by what its source is worth here.
    const worth = Object.keys(policy.when).length > (policy.when.about !== undefined ? 2 : 1) ? policy.score : observationConfidence(model, subject, policy.when.source)
    const reaches = Math.round((1 - (1 - current.score) * (1 - worth)) * 100) / 100
    if (reaches < current.threshold) continue
    const known = out.get(policy.name)
    if (!known || known.reaches < reaches) out.set(policy.name, { policy: policy.name, source: policy.when.source, reaches })
  }
  return [...out.values()].sort((a, b) => b.reaches - a.reaches || (a.policy < b.policy ? -1 : 1))
}

/** Whether a pending proposal last changed at `updatedAt` is stale at `now`. */
export const isStale = (updatedAt: Date | string, now: Date): boolean =>
  now.getTime() - new Date(updatedAt).getTime() > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000

/** A pending proposal touching a record a search or ask found: its own words for it. */
export interface PendingChange {
  proposal: string
  /** The record it would replace, still current. */
  id: string
  /** The record that would replace it. */
  by: string
  score: number
  threshold: number
  stale?: boolean
  note: string
}

/** The pending proposals among `pending` that touch `ids`, as replaced or as replacement, in their order. */
export const pendingChanges = (
  pending: readonly { proposal: string; id: string; by: string; reason: string; score: number; threshold: number; stale: boolean }[],
  ids: readonly string[]
): PendingChange[] => {
  const wanted = new Set(ids)
  return pending
    .filter((each) => wanted.has(each.id) || wanted.has(each.by))
    .map((each) => ({
      proposal: each.proposal,
      id: each.id,
      by: each.by,
      score: each.score,
      threshold: each.threshold,
      ...(each.stale ? { stale: true } : {}),
      note: pendingNote({ ...each, id: each.proposal }, each.id)
    }))
}

/** Two decimals, as scores are given. */
const figure = (value: number): string => value.toFixed(2)

/**
 * A pending proposal in a sentence, beside the record it would replace -
 * `record` names it, where the reader cannot tell which record is meant.
 */
export const pendingNote = (
  proposal: { id: string; by: string; reason: string; score: number; threshold: number; stale?: boolean },
  record?: string
): string =>
  `A pending proposal (${proposal.id}, ${figure(proposal.score)} of ${figure(proposal.threshold)}) says ${record ?? 'it'} is replaced by ${proposal.by}: ` +
  `${proposal.reason.trim().replace(/([^.!?])$/, '$1.')} It is not yet fact, so ${record ?? 'this record'} is still current` +
  `${proposal.stale ? '; the proposal has had no change in 30 days' : ''}.`

/** What `docket_supersede` and `docket_add_evidence` tell the agent about a proposal. */
export const proposalNote = (status: ProposalStatus, score: ProposalScore, carry: readonly { policy: string; reaches: number }[]): string =>
  status === 'accepted'
    ? `Accepted: its evidence scores ${figure(score.score)}, over the ${figure(score.threshold)} bar.`
    : status === 'rejected'
      ? 'Rejected: the older record stays current.'
      : `Recorded, not yet fact: its evidence scores ${figure(score.score)} of the ${figure(score.threshold)} it needs. ` +
        (carry.length
          ? `It needs more support, such as ${carry
              .slice(0, 3)
              .map((each) => `${each.policy} (${figure(each.reaches)})`)
              .join(', ')}: add it with docket_add_evidence and the proposal's id as supersession.`
          : 'It needs more independent support: add it with docket_add_evidence and the proposal\'s id as supersession.')
