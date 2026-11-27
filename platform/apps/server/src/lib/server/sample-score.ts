// SPDX-License-Identifier: AGPL-3.0-only
import { bandOf, explain, scoreObservation, type MemoryEvidence, type Subject } from '@chrisjowen/docket'
import { orgTrust, parseOntology, readWorkspace, trustModel, type StoreContext } from '@docket/platform-canonical-store'

export const text = (value: unknown, max = 2000): string | undefined => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)

/** A map of short strings, as a sample observation's claims or locator fields give them. */
function strings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 20)
      .flatMap(([key, item]) => (typeof item === 'string' && item.trim() ? [[key.slice(0, 64), item.trim().slice(0, 500)]] : [])),
  )
}

/** A claim typed in a box, as a policy compares it: a number or a boolean when it reads as one. */
const claim = (value: string): string | number | boolean =>
  value === 'true' || value === 'false' ? value === 'true' : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value

/**
 * The Policies tab's "What would this evidence score?": one sample
 * observation priced by the draft's policies over what the org attests -
 * docket's own `scoreObservation`, so the preview is the engine - and, given
 * a record of the workspace, what adding it would do to that record's
 * confidence. A docket not made yet (`workspaceId` null) has no records.
 * Writes nothing.
 */
export async function scoreSample(ctx: StoreContext, workspaceId: string | null, body: Record<string, unknown>, yaml: string, source: string) {
  const ontology = parseOntology(yaml).ontology
  if (!ontology) return { ok: false as const, problem: 'The draft is not a valid ontology yet.' }
  const model = trustModel(ontology, await orgTrust(ctx))
  const about = text(body.about, 100)
  const subject: Subject = about && ontology.relationships[about] ? { kind: 'relationship', rel: about } : { kind: 'resource', type: about ?? '' }
  const instance = text(body.instance, 500)
  const identity = model.sources[source]?.kind === 'identity'
  const claims = Object.fromEntries(Object.entries(strings(body.claims)).map(([key, value]) => [key, claim(value)]))
  const observation: MemoryEvidence = {
    source,
    ...(instance ? { sourceRef: instance } : {}),
    ...(Object.keys(claims).length ? { attributes: claims } : {}),
    ...(Object.keys(strings(body.locator)).length ? { locator: strings(body.locator) } : {}),
    // A person giving evidence of their own: the one named is the one the writer acts for.
    ...(identity && instance ? { principal: instance } : {}),
  }
  const scored = scoreObservation(model, subject, observation)
  const raw = (scored.base?.score ?? model.fallback) + scored.adjustments.reduce((sum, each) => sum + (each.adjust ?? 0), 0)
  const record = text(body.record, 200)
  let combined: { id: string; title: string; before: number; after: number; sameInstance: boolean } | null = null
  if (record && workspaceId) {
    const entity = (await readWorkspace(ctx, workspaceId)).entities.find((each) => each.id === record)
    if (entity) {
      const recordSubject: Subject = { kind: 'resource', type: entity.type }
      const before = explain(model, recordSubject, entity.evidence)
      const after = explain(model, recordSubject, [...entity.evidence, observation])
      const instanceOf = scoreObservation(model, recordSubject, observation).source.instance
      combined = {
        id: entity.id,
        title: entity.title,
        before: before.confidence,
        after: after.confidence,
        sameInstance: before.observations.some((each) => each.source.instance === instanceOf),
      }
    }
  }
  return {
    ok: true as const,
    score: scored.score,
    band: bandOf(model, scored.score),
    clamped: Math.round(raw * 100) / 100 !== scored.score,
    fallback: model.fallback,
    cap: model.cap,
    source: scored.source,
    base: scored.base ?? null,
    beaten: scored.beaten,
    adjustments: scored.adjustments,
    record: combined,
  }
}
