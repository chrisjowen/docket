// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a record stands, as its trust stamp reads: Overruled once something
 * supersedes it, Uncorroborated when its band is Unverified or it has no exhibits, Sole
 * source on one kind of source, Corroborated on several, and Not on record
 * for a reference no document files.
 */
import { bandOf } from '$lib/trust/bands'

import { supersededOf, type UiEntity } from './model'

export type StandingKey = 'overruled' | 'uncorroborated' | 'sole' | 'corroborated' | 'unfiled'

export interface RecordStanding {
  key: StandingKey
  label: string
  /** The stamp's colour. */
  tone: 'red' | 'warn' | 'ok'
}

const STANDINGS: Record<StandingKey, RecordStanding> = {
  overruled: { key: 'overruled', label: 'Overruled', tone: 'red' },
  uncorroborated: { key: 'uncorroborated', label: 'Uncorroborated', tone: 'red' },
  sole: { key: 'sole', label: 'Sole source', tone: 'warn' },
  corroborated: { key: 'corroborated', label: 'Corroborated', tone: 'ok' },
  unfiled: { key: 'unfiled', label: 'Not on record', tone: 'red' },
}

/** The kinds of source behind a record: its assessment's, else its evidence's. */
export const sourcesOf = (entity: Pick<UiEntity, 'assessment' | 'evidence'>): string[] =>
  entity.assessment?.sources.length
    ? [...entity.assessment.sources]
    : [...new Set(entity.evidence.flatMap((item) => (typeof item.source === 'string' && item.source ? [item.source] : [])))].sort()

/** Its weight of evidence, 0 to 1, when docket has assessed it. */
export const weightOf = (entity: Pick<UiEntity, 'assessment'>): number | null => entity.assessment?.confidence ?? null

/** How many exhibits stand behind the record itself. */
export const exhibitCount = (entity: Pick<UiEntity, 'assessment' | 'evidence'>): number => entity.assessment?.evidenceCount ?? entity.evidence.length

/** Its band: the one the cloud scored it into, by the workspace's bands, else by docket's defaults. */
export const recordBand = (entity: Pick<UiEntity, 'assessment'> & { trust?: { band?: string } }) =>
  entity.trust?.band ?? (entity.assessment ? bandOf(entity.assessment.confidence) : undefined)

export function standingOf(entity: (Pick<UiEntity, 'assessment' | 'evidence' | 'frontmatter'> & { trust?: { band?: string } }) | undefined): RecordStanding {
  if (!entity) return STANDINGS.unfiled
  if (supersededOf(entity)) return STANDINGS.overruled
  if (exhibitCount(entity) === 0 || recordBand(entity) === 'unverified') return STANDINGS.uncorroborated
  return sourcesOf(entity).length > 1 ? STANDINGS.corroborated : STANDINGS.sole
}
