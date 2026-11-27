// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the schema editor names and colours what it shows, and what it reads
 * from the policies for one type or one source. No server imports: the
 * browser and its tests share it.
 */
import { conditionsOf, policiesOf, type OntologyModel, type PolicyModel } from './editor'

/** A type's colour: one of the app's series colours, the same for the same name everywhere. */
export function typeColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `var(--series-${(hash % 8) + 1})`
}

/** The policies that name a type or relationship, with their place in the list. */
export const policiesAbout = (model: OntologyModel, subject: string): { index: number; policy: PolicyModel }[] =>
  policiesOf(model)
    .map((policy, index) => ({ index, policy }))
    .filter(({ policy }) => policy.when.about === subject)

/** The policies about a source type, with their place in the list. */
export const policiesFor = (model: OntologyModel, source: string): { index: number; policy: PolicyModel }[] =>
  policiesOf(model)
    .map((policy, index) => ({ index, policy }))
    .filter(({ policy }) => policy.when.source === source)

/** The policies that apply to anything: they name no type. */
export const policiesForAnything = (model: OntologyModel): number => policiesOf(model).filter((policy) => !policy.when.about).length

/** The attribute and locator fields a policy on a source can test: `role`, `@path`. */
export function conditionFields(model: OntologyModel, source: string): string[] {
  const definition = model.sources?.[source]
  return [...Object.keys(definition?.attributes ?? {}), ...Object.keys(definition?.locator ?? {}).map((field) => `@${field}`)]
}

/** A policy's conditions that the source no longer declares: a renamed or removed attribute. */
export function unknownConditions(model: OntologyModel, policy: PolicyModel): string[] {
  const fields = new Set(conditionFields(model, policy.when.source))
  return conditionsOf(policy)
    .map(([field]) => field)
    .filter((field) => !fields.has(field))
}

/** Who may set an attribute, as the Sources tab names it. */
export const SETTER_LABELS = {
  directory: 'Directory',
  connection: 'Connection',
  registry: 'Registry',
  reporter: 'Writer · claimed',
} as const

/** A source's kind, as the Sources tab groups them. */
export const KIND_LABELS = { identity: 'Identity', system: 'System', content: 'Content' } as const

/** The confidence bands, as every page names them: the one definition in `$lib/trust/bands`. */
export { BAND_LABELS, BAND_STAMP } from '$lib/trust/bands'

type Attested = Record<string, unknown>

/** What the org attests about sources, as the Sources and Policies tabs show it. */
export interface TrustData {
  people: { login: string; name: string | null; role: string; attributes: Attested }[]
  registered: { source: string; instance: string; attributes: Attested }[]
  repositories: { fullName: string; attributes: Attested }[]
  manage: boolean
}
