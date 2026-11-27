// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Confidence bands: the one definition every view classifies by. A record is
 * Established, Probable or Unverified by the workspace ontology's
 * `trust.bands`, which the graph carries; docket's defaults stand in where a
 * page has no ontology to read. Nothing is hidden by its band: it is shown,
 * and classified.
 */

export type Band = 'established' | 'probable' | 'unverified'

export interface Bands {
  established: number
  probable: number
}

/** docket's defaults, for an ontology that names none. */
export const DEFAULT_BANDS: Bands = { established: 0.8, probable: 0.5 }

export const BANDS: readonly Band[] = ['established', 'probable', 'unverified']

/** The band a confidence falls in. */
export const bandOf = (confidence: number, bands: Bands = DEFAULT_BANDS): Band =>
  confidence >= bands.established - 1e-9 ? 'established' : confidence >= bands.probable - 1e-9 ? 'probable' : 'unverified'

export const BAND_LABELS: Record<Band, string> = { established: 'Established', probable: 'Probable', unverified: 'Unverified' }

/** The stamp colour each band is drawn in. */
export const BAND_STAMP: Record<Band, 'ok' | 'warn' | 'red'> = { established: 'ok', probable: 'warn', unverified: 'red' }

/** The weight bar's class for a band: high, middling or low. */
export const BAND_WEIGHT: Record<Band, 'high' | 'mid' | 'low'> = { established: 'high', probable: 'mid', unverified: 'low' }

const two = (value: number) => value.toFixed(2)

/** What a band covers, as a legend says it: "≥ 0.80", "0.50–0.80", "< 0.50". */
export const bandRange = (band: Band, bands: Bands = DEFAULT_BANDS): string =>
  band === 'established' ? `≥ ${two(bands.established)}` : band === 'probable' ? `${two(bands.probable)}–${two(bands.established)}` : `< ${two(bands.probable)}`

/** A band as a percentage range, for filters that speak in percent: "80%+", "50-79%", "under 50%". */
export const bandPercent = (band: Band, bands: Bands = DEFAULT_BANDS): string => {
  const pct = (value: number) => Math.round(value * 100)
  return band === 'established'
    ? `${pct(bands.established)}%+`
    : band === 'probable'
      ? `${pct(bands.probable)}-${pct(bands.established) - 1}%`
      : `under ${pct(bands.probable)}%`
}
