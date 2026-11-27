// SPDX-License-Identifier: AGPL-3.0-only
import { proposalSubject } from '@chrisjowen/docket/workspace'

import { bandOf, explain, type ConfidenceModel, type Explanation, type MemoryEntity, type Subject } from './docket.js'

/**
 * How a confidence was reached, for a reader: the trust design's "Why 0.93".
 * docket's `explain` gives every observation, the policy that priced it, the
 * ones it beat, the adjustments and whether it counts; this groups them by
 * source instance, the unit that counts once, and keeps what a page shows.
 */

export type Band = 'established' | 'probable' | 'unverified'

/** One attribute of a source as the scoring saw it: attested, claimed by the writer, or a claim that did not count. */
export interface ShownAttribute {
  name: string
  value: string
  how: 'attested' | 'claimed' | 'ignored'
}

/** A policy that priced an observation, and what it said: a score, or an adjustment. */
export interface PricedBy {
  policy: string
  value: number
  adjust?: boolean
}

export interface ExplainedEvidence {
  note?: string
  /** The fields it points with: a path, a URL, a section. */
  locator: Record<string, string>
  /** Who filed it, and for whom: recorded, never scored. */
  observedBy?: string
  principal?: string
  observedAt?: string
  reportedBy?: string
  /** A person it names other than the writer's: it counts as the writer's until they confirm. */
  secondHand?: string
  /** It cites no source: the person the writer acts for is the source. */
  self: boolean
  score: number
  /** False: a stronger observation of the same source counts instead. */
  counts: boolean
  base?: PricedBy
  beaten: PricedBy[]
  adjustments: PricedBy[]
}

/** The observations of one source instance: it counts once, at its strongest. */
export interface SourceGroup {
  /** The source type; empty for evidence that names none. */
  source: string
  /** The instance - a person, a repository, a document - or null when the evidence does not say which. */
  instance: string | null
  attributes: ShownAttribute[]
  best: number
  observations: ExplainedEvidence[]
}

export interface Explained {
  confidence: number
  band: Band
  basis: Explanation['basis']
  cap: number
  groups: SourceGroup[]
}

const text = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : String(value))

const priced = (match: { policy: string; score?: number; adjust?: number }): PricedBy =>
  match.adjust !== undefined ? { policy: match.policy, value: match.adjust, adjust: true } : { policy: match.policy, value: match.score ?? 0 }

/** An explanation grouped by source instance, strongest first. */
export function grouped(model: ConfidenceModel, explanation: Explanation): Explained {
  const groups = new Map<string, SourceGroup>()
  for (const observed of explanation.observations) {
    const resolved = observed.source
    // Evidence that names no source has no instance: docket counts it together, as one source.
    const key = resolved.instance ?? ''
    const evidence = observed as typeof observed & ExplainedLike
    let group = groups.get(key)
    if (!group) {
      group = {
        source: resolved.source ?? '',
        instance: resolved.source && key.startsWith(`${resolved.source}:`) ? key.slice(resolved.source.length + 1) : null,
        attributes: [],
        best: 0,
        observations: [],
      }
      groups.set(key, group)
    }
    const merge = (names: readonly string[], how: ShownAttribute['how'], value: (name: string) => string) => {
      for (const name of names) {
        if (!group!.attributes.some((attribute) => attribute.name === name && attribute.how === how)) {
          group!.attributes.push({ name, value: value(name), how })
        }
      }
    }
    merge(resolved.attested, 'attested', (name) => text(resolved.attributes[name]))
    merge(resolved.claimed, 'claimed', (name) => text(resolved.attributes[name]))
    merge(resolved.ignored, 'ignored', (name) => text(evidence.raw?.attributes?.[name] ?? ''))
    group.best = Math.max(group.best, observed.score)
    group.observations.push({
      ...(evidence.raw?.note ? { note: evidence.raw.note } : {}),
      locator: Object.fromEntries(Object.entries(resolved.locator).map(([field, value]) => [field, text(value)])),
      ...(evidence.raw?.observedBy ? { observedBy: evidence.raw.observedBy } : {}),
      ...(evidence.raw?.principal ? { principal: evidence.raw.principal } : {}),
      ...(evidence.raw?.observedAt ? { observedAt: evidence.raw.observedAt } : {}),
      ...(evidence.raw?.reportedBy ? { reportedBy: evidence.raw.reportedBy } : {}),
      ...(resolved.secondHand ? { secondHand: resolved.secondHand } : {}),
      self: resolved.source !== undefined && model.sources[resolved.source]?.kind === 'identity' && !evidence.raw?.sourceRef && !resolved.secondHand,
      score: observed.score,
      counts: observed.counts,
      ...(observed.base ? { base: priced(observed.base) } : {}),
      beaten: observed.beaten.map(priced),
      adjustments: observed.adjustments.map(priced),
    })
  }
  return {
    confidence: explanation.confidence,
    band: bandOf(model, explanation.confidence),
    basis: explanation.basis,
    cap: model.cap,
    groups: [...groups.values()].sort((a, b) => b.best - a.best),
  }
}

/** What `grouped` reads of the evidence entry itself, beside docket's working. */
type ExplainedLike = {
  raw?: { note?: string; observedBy?: string; principal?: string; observedAt?: string; reportedBy?: string; sourceRef?: string; attributes?: Record<string, unknown> }
}

/** docket's explanation of a subject's evidence, with each observation's own entry kept beside its working. */
function withEntries(model: ConfidenceModel, subject: Subject, evidence: readonly MemoryEntity['evidence'][number][], stated?: number): Explanation {
  const explanation = explain(model, subject, evidence, stated)
  // `explain` keeps the evidence's order: pair each observation with its entry.
  return { ...explanation, observations: explanation.observations.map((observed, index) => ({ ...observed, raw: evidence[index] }) as typeof observed) }
}

/** A record's confidence, explained. */
export function explainEntity(model: ConfidenceModel, entity: Pick<MemoryEntity, 'type' | 'evidence' | 'provenance'>): Explained {
  const stated = typeof entity.provenance?.confidence === 'number' ? entity.provenance.confidence : undefined
  return grouped(model, withEntries(model, { kind: 'resource', type: entity.type }, entity.evidence, stated))
}

/** A link's confidence, explained. */
export function explainLink(model: ConfidenceModel, rel: string, evidence: MemoryEntity['evidence']): Explained {
  return grouped(model, withEntries(model, { kind: 'relationship', rel }, evidence))
}

/** A supersede proposal's score, explained: its own evidence only, about `supersedes` or the replaced record's type. */
export function explainProposal(model: ConfidenceModel, type: string | undefined, evidence: MemoryEntity['evidence']): Explained {
  return grouped(model, withEntries(model, proposalSubject(type ?? ''), evidence))
}

/** One source of a record as the graph's hover card names it: its best observation, and the rules that priced it. */
export interface SourceLine {
  source: string
  instance: string | null
  score: number
  rules: PricedBy[]
  self: boolean
}

/** What the graph carries for each record and link: its band, and a line per source for the hover card. */
export interface TrustSummary {
  band: Band
  sources: SourceLine[]
}

/** The hover card's summary of an explanation: per source, the observation that counts. */
export function summarise(explained: Explained): TrustSummary {
  return {
    band: explained.band,
    sources: explained.groups.map((group) => {
      const counted = group.observations.find((observation) => observation.counts) ?? group.observations[0]
      return {
        source: group.source,
        instance: group.instance,
        score: group.best,
        rules: counted ? [...(counted.base ? [counted.base] : []), ...counted.adjustments] : [],
        self: counted?.self ?? false,
      }
    }),
  }
}
