import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js'
import {
  type Assessment,
  type ConditionValue,
  type ConfidenceBands,
  type MemoryEvidence,
  type Ontology,
  type PolicyCondition,
  type SourceTypeDefinition,
  type TrustPolicy,
  EVIDENCE_LOCATION_FIELDS,
  ontologySchema
} from '../model/index.js'
import { usesTrustSettings, withTrustSettings } from './legacy.js'

/** What an ontology in the current form gets for each threshold it leaves out. */
export const TRUST_DEFAULTS = {
  unevidenced: 0.5,
  fallback: 0.4,
  cap: 0.99,
  accept: { default: 0.75, decision: 0.8 } as Readonly<Record<string, number>>,
  bands: { established: 0.8, probable: 0.5 } as Readonly<ConfidenceBands>
} as const

/**
 * Attested attributes of source instances: what the people directory, a
 * connection or the source registry says about a person, a repository or a
 * document. Writers cannot set these.
 */
export interface SourceRegistry {
  attributes(source: string, instance: string): Readonly<Record<string, ConditionValue | ConditionValue[]>> | undefined
}

const NO_REGISTRY: SourceRegistry = { attributes: () => undefined }

/** Everything needed to turn evidence into a confidence, resolved once per ontology. */
export interface ConfidenceModel {
  sources: Record<string, SourceTypeDefinition>
  policies: readonly TrustPolicy[]
  /** Confidence of a resource with no evidence and no stated confidence. */
  unevidenced: number
  /** What an observation no `score` policy matches is worth. */
  fallback: number
  cap: number
  /** The score a supersede proposal needs, by the replaced record's type; `default` otherwise. */
  accept: Readonly<Record<string, number>>
  bands: ConfidenceBands
  registry: SourceRegistry
}

/** What is being judged: a resource of some type, or a relationship. */
export type Subject =
  | { kind: 'resource'; type: string }
  | { kind: 'relationship'; rel: string }

let builtin: Ontology | undefined

/**
 * The ontology `docket init` writes, in the current form. Its sources and
 * policies are what an ontology that says nothing about trust is read with.
 */
export const builtinOntology = (): Ontology => {
  builtin ??= withTrustSettings(ontologySchema.parse(parseYaml(readFileSync(DEFAULT_ONTOLOGY_PATH, 'utf8'))))
  return builtin
}

/**
 * The ontology's sources, policies and thresholds. Legacy evidence settings
 * are converted first (`withTrustSettings`), so they score as they always
 * did; an ontology in the current form takes nothing from docket's built-in
 * one.
 */
export const confidenceModel = (
  ontology: Ontology,
  options: { defaults?: Ontology; registry?: SourceRegistry } = {}
): ConfidenceModel => {
  const current = usesTrustSettings(ontology) ? ontology : withTrustSettings(ontology, options.defaults ?? builtinOntology())
  const trust = current.trust ?? {}
  return {
    sources: current.sources ?? {},
    policies: trust.policies ?? [],
    unevidenced: trust.unevidenced ?? TRUST_DEFAULTS.unevidenced,
    fallback: trust.fallback ?? TRUST_DEFAULTS.fallback,
    cap: trust.cap ?? TRUST_DEFAULTS.cap,
    accept: { ...TRUST_DEFAULTS.accept, ...trust.accept },
    bands: { ...TRUST_DEFAULTS.bands, ...trust.bands },
    registry: options.registry ?? NO_REGISTRY
  }
}

// --- Resolving a source -------------------------------------------------------

/** An observation's source as the policies see it. */
export interface ResolvedSource {
  /** The source type. */
  source: string
  /**
   * What counts once: `<source>:<instance>` for a known instance, or the
   * source type alone when the observation does not say which instance.
   */
  instance: string
  /** Attested attributes, then the claims the source type lets a writer make. */
  attributes: Record<string, ConditionValue | ConditionValue[]>
  /** Attribute names whose value came from the directory, a connection or the registry. */
  attested: string[]
  /** Attribute names whose value the writer claimed and the source type accepts. */
  claimed: string[]
  /** Claims that do not count: the attribute is not the writer's to set, or not declared. */
  ignored: string[]
  /** Every locator field the observation gives, the legacy ones included. */
  locator: Record<string, string | string[]>
}

/** The fields an observation points with: the legacy top-level ones and its `locator` map. */
export const locatorOf = (observation: MemoryEvidence): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {}
  for (const field of EVIDENCE_LOCATION_FIELDS) {
    const value = observation[field]
    if (value !== undefined) out[field] = value
  }
  return { ...out, ...observation.locator }
}

const instanceOf = (
  observation: MemoryEvidence,
  definition: SourceTypeDefinition | undefined,
  locator: Record<string, string | string[]>
): string | undefined => {
  if (observation.sourceRef !== undefined) return observation.sourceRef
  const fields = definition?.identifiedBy ?? []
  if (fields.length === 0) return undefined
  const values = fields.map((field) => locator[field])
  if (values.some((value) => value === undefined)) return undefined
  return values.map((value) => (Array.isArray(value) ? value.join(',') : value)).join('/')
}

/**
 * Which source an observation is from, which instance of it, and what is
 * known about that instance. Attested values win over claims, and a claim
 * only counts for an attribute the source type marks `setBy: reporter`.
 */
export const resolveSource = (model: ConfidenceModel, observation: MemoryEvidence): ResolvedSource => {
  const definition = model.sources[observation.source]
  const locator = locatorOf(observation)
  const instance = instanceOf(observation, definition, locator)
  const declared = definition?.attributes ?? {}

  const attributes: ResolvedSource['attributes'] = {}
  const attested: string[] = []
  const known = instance === undefined ? undefined : model.registry.attributes(observation.source, instance)
  for (const [name, value] of Object.entries(known ?? {})) {
    attributes[name] = value
    attested.push(name)
  }

  const claimed: string[] = []
  const ignored: string[] = []
  for (const [name, value] of Object.entries(observation.attributes ?? {})) {
    if (declared[name]?.setBy === 'reporter' && !(name in attributes)) {
      attributes[name] = value
      claimed.push(name)
    } else if (!(name in attributes) || attributes[name] !== value) {
      ignored.push(name)
    }
  }

  return {
    source: observation.source,
    instance: instance === undefined ? observation.source : `${observation.source}:${instance}`,
    attributes,
    attested,
    claimed,
    ignored,
    locator
  }
}

// --- Matching policies --------------------------------------------------------

const globCache = new Map<string, RegExp>()

/** `**` crosses directories, `*` and `?` do not; `**\/` may match nothing. */
const globToRegExp = (glob: string): RegExp => {
  let cached = globCache.get(glob)
  if (cached) return cached
  let pattern = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        pattern += '(?:.*/)?'
        i += 2
      } else {
        pattern += '.*'
        i += 1
      }
    } else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  cached = new RegExp(`^${pattern}$`)
  globCache.set(glob, cached)
  return cached
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value])

/** Whether a condition holds for a value, which is `undefined` when the source does not have it. */
export const conditionHolds = (condition: PolicyCondition, value: unknown): boolean => {
  if (typeof condition !== 'object') return value !== undefined && listOf(value).includes(condition)
  const checks: boolean[] = []
  if (condition.exists !== undefined) checks.push((value !== undefined) === condition.exists)
  if (condition.not !== undefined) checks.push(!listOf(value).includes(condition.not))
  if (condition.in !== undefined) checks.push(value !== undefined && listOf(value).some((item) => condition.in?.includes(item as ConditionValue)))
  if (condition.has !== undefined) checks.push(value !== undefined && listOf(value).includes(condition.has))
  if (condition.gt !== undefined) checks.push(typeof value === 'number' && value > condition.gt)
  if (condition.lt !== undefined) checks.push(typeof value === 'number' && value < condition.lt)
  if (condition.matches !== undefined) {
    const pattern = globToRegExp(condition.matches)
    checks.push(value !== undefined && listOf(value).some((item) => typeof item === 'string' && pattern.test(item)))
  }
  return checks.every(Boolean)
}

/** The keys of a policy's `when` that test the source: everything but `about` and `source`. */
export const policyConditions = (policy: TrustPolicy): [string, PolicyCondition][] =>
  Object.entries(policy.when).filter(
    (entry): entry is [string, PolicyCondition] => entry[0] !== 'about' && entry[0] !== 'source' && entry[1] !== undefined
  )

/** How specific a policy is: naming what it is about counts one, and so does each condition. */
export const specificity = (policy: TrustPolicy): number =>
  (policy.when.about !== undefined ? 1 : 0) + policyConditions(policy).length

const subjectName = (subject: Subject): string => (subject.kind === 'resource' ? subject.type : subject.rel)

/** Whether a policy applies to an observation of `subject` from `source`. */
export const policyMatches = (policy: TrustPolicy, subject: Subject, source: ResolvedSource): boolean => {
  if (policy.when.source !== source.source) return false
  if (policy.when.about !== undefined && policy.when.about !== subjectName(subject)) return false
  return policyConditions(policy).every(([key, condition]) =>
    conditionHolds(condition, key.startsWith('@') ? source.locator[key.slice(1)] : source.attributes[key])
  )
}

// --- Scoring ------------------------------------------------------------------

/** A policy that applied to an observation, and what it said. */
export interface PolicyMatch {
  policy: string
  score?: number
  adjust?: number
}

/** How one observation was priced. */
export interface ObservationScore {
  source: ResolvedSource
  /** The `score` policy that set the price; absent when none matched and the fallback did. */
  base?: PolicyMatch
  /** Other `score` policies that matched but lost: less specific, or a tie at a higher score. */
  beaten: PolicyMatch[]
  /** Every `adjust` policy that matched, in order. */
  adjustments: PolicyMatch[]
  score: number
}

/** Two decimal places: finer than that is noise, and it keeps projections readable. */
const round = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, cap: number): number => Math.min(cap, Math.max(0, value))

/**
 * What one observation of `subject` is worth: the most specific matching
 * `score` policy, ties going to the lower score, or the fallback when none
 * matches; then every matching `adjust` policy, added; then held to
 * `[0, cap]`.
 */
export const scoreObservation = (
  model: ConfidenceModel,
  subject: Subject,
  observation: MemoryEvidence
): ObservationScore => {
  const source = resolveSource(model, observation)
  const matching = model.policies.filter((policy) => policyMatches(policy, subject, source))
  const bases = matching
    .filter((policy) => policy.score !== undefined)
    .sort((a, b) => specificity(b) - specificity(a) || (a.score as number) - (b.score as number))
  const adjustments = matching
    .filter((policy) => policy.adjust !== undefined)
    .map((policy) => ({ policy: policy.name, adjust: policy.adjust as number }))

  const [winner, ...beaten] = bases
  const start = winner?.score ?? model.fallback
  const adjusted = adjustments.reduce((total, adjustment) => total + adjustment.adjust, start)
  // Only an adjustment can leave float noise: 0.8 - 0.1 is 0.7000000000000001.
  const score = clamp(adjustments.length > 0 ? round(adjusted) : adjusted, model.cap)
  return {
    source,
    ...(winner ? { base: { policy: winner.name, score: winner.score as number } } : {}),
    beaten: beaten.map((policy) => ({ policy: policy.name, score: policy.score as number })),
    adjustments,
    score
  }
}

/** What one observation from `source`, with nothing more said about it, is worth for `subject`. */
export const observationConfidence = (model: ConfidenceModel, subject: Subject, source: string): number =>
  scoreObservation(model, subject, { source }).score

/** An observation's price, and whether it is the one its source instance counts. */
export interface ExplainedObservation extends ObservationScore {
  counts: boolean
}

/** An assessment with the working shown: every observation, what priced it, and which count. */
export interface Explanation extends Assessment {
  observations: ExplainedObservation[]
}

/**
 * Combines independent evidence, showing the working. Observations of one
 * source instance share its failure mode - a second file in the same
 * repository is not a second opinion - so within an instance only the
 * strongest counts. Across instances they are treated as independent:
 * `1 - Π(1 - s)`, held to the cap. An observation that does not say which
 * instance it is from counts with every other such observation of its source
 * type, which is how evidence written before source instances scores.
 *
 * With no evidence at all, a stated confidence (a file's
 * `provenance.confidence`) is taken as given, and otherwise `unevidenced`.
 */
export const explain = (
  model: ConfidenceModel,
  subject: Subject,
  evidence: readonly MemoryEvidence[],
  stated?: number
): Explanation => {
  if (evidence.length === 0) {
    return stated === undefined
      ? { confidence: model.unevidenced, basis: 'unevidenced', evidenceCount: 0, sources: [], observations: [] }
      : { confidence: stated, basis: 'stated', evidenceCount: 0, sources: [], observations: [] }
  }

  const scored = evidence.map((observation) => scoreObservation(model, subject, observation))
  const strongest = new Map<string, number>()
  scored.forEach(({ source, score }, index) => {
    const best = strongest.get(source.instance)
    if (best === undefined || score > (scored[best] as ObservationScore).score) strongest.set(source.instance, index)
  })

  let doubt = 1
  for (const index of strongest.values()) doubt *= 1 - (scored[index] as ObservationScore).score
  const counted = new Set(strongest.values())

  return {
    confidence: round(clamp(1 - doubt, model.cap)),
    basis: 'evidence',
    evidenceCount: evidence.length,
    sources: [...new Set(scored.map(({ source }) => source.source))].sort(),
    observations: scored.map((observation, index) => ({ ...observation, counts: counted.has(index) }))
  }
}

/** How far `subject` can be trusted on this evidence: `explain` without the working. */
export const assess = (
  model: ConfidenceModel,
  subject: Subject,
  evidence: readonly MemoryEvidence[],
  stated?: number
): Assessment => {
  const { confidence, basis, evidenceCount, sources } = explain(model, subject, evidence, stated)
  return { confidence, basis, evidenceCount, sources }
}

/** The band a confidence falls in: established, probable, or below both, unverified. */
export const bandOf = (model: Pick<ConfidenceModel, 'bands'>, confidence: number): 'established' | 'probable' | 'unverified' =>
  confidence >= model.bands.established ? 'established' : confidence >= model.bands.probable ? 'probable' : 'unverified'
