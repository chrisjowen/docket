// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ontology editor's edits, made on the draft's YAML document rather than
 * on a plain object, so comments, order and layout outside what changed stay
 * as the author wrote them. Shared by the browser and its tests; no server
 * imports.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'

export type Constraint = '*' | string[]

export interface AttributeModel {
  type: string
  enum?: (string | number)[]
  description?: string
}

export interface TypeModel {
  description?: string
  icon?: string
  attributes?: Record<string, AttributeModel>
  extraction?: { instructions?: string; clues?: string[]; doNotConfuseWith?: string[] }
  confidence?: Record<string, number>
}

export interface RelationshipModel {
  description?: string
  from: Constraint
  to: Constraint
  attributes?: Record<string, AttributeModel>
  confidence?: Record<string, number>
}

/** A legacy evidence source: a number on the kind of evidence. Read only to offer converting it. */
export interface SourceModel {
  description?: string
  confidence: number
  requires?: string[]
  requiresAny?: string[]
}

/** Who may set a source attribute: the directory, a connection or the registry attest it; the reporter only claims it. */
export const SETTERS = ['directory', 'connection', 'registry', 'reporter'] as const
export type Setter = (typeof SETTERS)[number]
export const SOURCE_KINDS = ['identity', 'system', 'content'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export interface SourceAttributeModel extends AttributeModel {
  setBy: Setter
}

/** A kind of source evidence comes from, with the attributes policies test and the fields an observation points with. */
export interface SourceTypeModel {
  description?: string
  kind?: SourceKind
  identifiedBy?: string[]
  attributes?: Record<string, SourceAttributeModel>
  locator?: Record<string, { description?: string; required?: boolean }>
  requiresAny?: string[]
}

export type ConditionValue = string | number | boolean
export type ConditionModel = ConditionValue | { not?: ConditionValue; in?: ConditionValue[]; has?: ConditionValue; gt?: number; lt?: number; exists?: boolean; matches?: string }

/** One confidence policy: a `score` sets an observation's price, an `adjust` moves it. */
export interface PolicyModel {
  name: string
  description?: string
  when: { about?: string; source: string; [condition: string]: ConditionModel | undefined }
  score?: number
  adjust?: number
}

export interface TrustSettingsModel {
  unevidenced?: number
  fallback?: number
  cap?: number
  accept?: Record<string, number>
  bands?: { established?: number; probable?: number }
  policies?: PolicyModel[]
}

export interface OntologyModel {
  version?: number
  resourceTypes: Record<string, TypeModel>
  relationships: Record<string, RelationshipModel>
  sources?: Record<string, SourceTypeModel>
  trust?: TrustSettingsModel
  evidence?: { unevidenced?: number; sources?: Record<string, SourceModel> }
}

/** docket's defaults for what a `trust:` block leaves out. */
export const TRUST_DEFAULTS = { unevidenced: 0.5, fallback: 0.4, cap: 0.99, accept: 0.75, established: 0.8, probable: 0.5 } as const

export type Path = (string | number)[]

/** A name for a type, relationship, attribute or evidence source: lowercase, starting with a letter. */
export const NAME = /^[a-z][a-z0-9_-]{0,62}$/

export function nameProblem(name: string, taken: readonly string[]): string | null {
  if (!NAME.test(name)) return 'Use lowercase letters, digits, - or _, starting with a letter.'
  if (taken.includes(name)) return `"${name}" is already defined.`
  return null
}

export interface Parsed {
  doc: Document
  model: OntologyModel | null
  /** YAML syntax errors; the form view needs a document that parses. */
  error: string | null
}

export function parse(text: string): Parsed {
  const doc = parseDocument(text)
  if (doc.errors.length) return { doc, model: null, error: doc.errors[0]?.message ?? 'not valid YAML' }
  const js = (doc.toJS() ?? {}) as Partial<OntologyModel>
  return {
    doc,
    model: {
      ...js,
      resourceTypes: (js.resourceTypes ?? {}) as Record<string, TypeModel>,
      relationships: (js.relationships ?? {}) as Record<string, RelationshipModel>,
    },
    error: null,
  }
}

/** Applies one edit to the text and returns the new text. */
export function edit(text: string, change: (doc: Document) => void): string {
  const doc = parseDocument(text)
  change(doc)
  return doc.toString({ flowCollectionPadding: false })
}

const empty = (value: unknown) =>
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)

/**
 * Sets a value, or removes it when it is empty, and drops a parent map that it
 * leaves empty, up to but never including the type, relationship or source itself.
 */
export function setValue(doc: Document, path: Path, value: unknown): void {
  if (empty(value)) {
    doc.deleteIn(path)
    for (let depth = path.length - 1; depth >= 3; depth -= 1) {
      const parent = doc.getIn(path.slice(0, depth), true)
      if (isMap(parent) && parent.items.length === 0) doc.deleteIn(path.slice(0, depth))
      else break
    }
    return
  }
  doc.setIn(path, value)
}

/** Renames a key of the map at `path` in place, keeping its position and value. */
export function renameKey(doc: Document, path: Path, from: string, to: string): void {
  const map = path.length ? doc.getIn(path, true) : doc.contents
  if (!isMap(map)) return
  const pair = map.items.find((item) => (isScalar(item.key) ? item.key.value : item.key) === from)
  if (pair) pair.key = doc.createNode(to)
}

function mapAt(doc: Document, path: Path) {
  const node = doc.getIn(path, true)
  if (isMap(node)) return node
  doc.setIn(path, doc.createNode({}))
  return doc.getIn(path, true)
}

/** Adds an empty resource type at the end of `resourceTypes`. */
export function addType(doc: Document, name: string, description?: string): void {
  mapAt(doc, ['resourceTypes'])
  doc.setIn(['resourceTypes', name], doc.createNode(description ? { description } : {}))
}

/** Rewrites every relationship end that names `from`, so the type keeps its relationships under its new name. */
function retarget(doc: Document, from: string, to: string | null): void {
  const relationships = doc.get('relationships', true)
  if (!isMap(relationships)) return
  for (const pair of relationships.items) {
    if (!isMap(pair.value)) continue
    for (const end of ['from', 'to'] as const) {
      const list = pair.value.get(end, true)
      if (!isSeq(list)) continue
      list.items = list.items.flatMap((item) => {
        const value = isScalar(item) ? item.value : item
        if (value !== from) return [item]
        return to === null ? [] : [doc.createNode(to)]
      })
    }
  }
}

/** Renames a type, and the relationship ends that name it. Documents of the old type need a `renameType` migration. */
export function renameType(doc: Document, from: string, to: string): void {
  renameKey(doc, ['resourceTypes'], from, to)
  retarget(doc, from, to)
}

/** Removes a type, and drops it from the relationship ends that name it. */
export function removeType(doc: Document, name: string): void {
  doc.deleteIn(['resourceTypes', name])
  retarget(doc, name, null)
}

export function addRelationship(doc: Document, name: string, from: Constraint, to: Constraint): void {
  mapAt(doc, ['relationships'])
  doc.setIn(['relationships', name], doc.createNode({ from, to }))
}

export function setConstraint(doc: Document, relationship: string, end: 'from' | 'to', value: Constraint): void {
  doc.setIn(['relationships', relationship, end], doc.createNode(value))
}

export function addSource(doc: Document, name: string, confidence: number): void {
  mapAt(doc, ['evidence'])
  mapAt(doc, ['evidence', 'sources'])
  doc.setIn(['evidence', 'sources', name], doc.createNode({ confidence }))
}

/** Splits a comma- or newline-separated field into its items; numbers stay numbers for a numeric enum. */
export function items(text: string, numeric = false): (string | number)[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (numeric && /^-?\d+(\.\d+)?$/.test(item) ? Number(item) : item))
}

/** Splits a field into its lines, without empty ones: for lists whose items may hold commas. */
export function lineItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// --- Sources and trust ----------------------------------------------------------

/** Whether the ontology says how it is trusted in the current form: `sources:` or `trust:`. */
export const usesTrust = (model: OntologyModel): boolean => model.sources !== undefined || model.trust !== undefined

/** Whether it still holds legacy evidence settings: an `evidence:` block, or a type's or relationship's `confidence:` numbers. */
export const hasLegacyTrust = (model: OntologyModel): boolean =>
  model.evidence !== undefined ||
  Object.values(model.resourceTypes).some((type) => type.confidence !== undefined) ||
  Object.values(model.relationships).some((rel) => rel.confidence !== undefined)

/** A relationship that starts at a type: its own (it names the type in `from`), or one every type has (`from: *`). */
export interface Relation {
  name: string
  definition: RelationshipModel
  inherited: boolean
}

export function relationsFrom(model: OntologyModel, type: string): Relation[] {
  return Object.entries(model.relationships).flatMap(([name, definition]): Relation[] => {
    if (definition.from === '*') return [{ name, definition, inherited: true }]
    return Array.isArray(definition.from) && definition.from.includes(type) ? [{ name, definition, inherited: false }] : []
  })
}

/** The relationships of other types that can point at a type: what links in to it. */
export function relationsTo(model: OntologyModel, type: string): { name: string; from: string[]; definition: RelationshipModel }[] {
  return Object.entries(model.relationships).flatMap(([name, definition]) => {
    if (definition.from === '*' || !Array.isArray(definition.from)) return []
    const from = definition.from.filter((each) => each !== type)
    const reaches = definition.to === '*' || (Array.isArray(definition.to) && definition.to.includes(type))
    return reaches && from.length ? [{ name, from, definition }] : []
  })
}

/**
 * Lets `type` point along `name` to `target`: a new relationship from it, or
 * the type and target added to the one of that name. `*` as the target means
 * any type.
 */
export function addRelation(doc: Document, model: OntologyModel, type: string, name: string, target: string): void {
  const existing = model.relationships[name]
  if (!existing) {
    addRelationship(doc, name, [type], target === '*' ? '*' : [target])
    return
  }
  if (existing.from !== '*' && !existing.from.includes(type)) setConstraint(doc, name, 'from', [...existing.from, type])
  if (target === '*') setConstraint(doc, name, 'to', '*')
  else if (existing.to !== '*' && !existing.to.includes(target)) setConstraint(doc, name, 'to', [...existing.to, target])
}

/** Stops `type` pointing along `name`; the relationship goes when no type is left at its start. */
export function detachRelation(doc: Document, model: OntologyModel, type: string, name: string): void {
  const existing = model.relationships[name]
  if (!existing || existing.from === '*') return
  const from = existing.from.filter((each) => each !== type)
  if (from.length) setConstraint(doc, name, 'from', from)
  else doc.deleteIn(['relationships', name])
}

/** The types a relationship can point to, `*` for any; an emptied list keeps the relationship but points nowhere. */
export function setTargets(doc: Document, name: string, to: Constraint): void {
  setConstraint(doc, name, 'to', to)
}

/** Adds a source type of a kind. */
export function addSourceType(doc: Document, name: string, kind: SourceKind): void {
  mapAt(doc, ['sources'])
  doc.setIn(['sources', name], doc.createNode({ kind }))
}

/** The trust policies, in their order. */
export const policiesOf = (model: OntologyModel): PolicyModel[] => model.trust?.policies ?? []

/** Writes the whole policy list: the YAML sequence is replaced, so its items keep the order given. */
export function setPolicies(doc: Document, policies: PolicyModel[]): void {
  mapAt(doc, ['trust'])
  doc.setIn(['trust', 'policies'], doc.createNode(policies, { flow: false }))
  // One policy to a line, as docket writes them: each `when` on one line.
  const sequence = doc.getIn(['trust', 'policies'], true)
  if (isSeq(sequence)) {
    for (const item of sequence.items) {
      if (!isMap(item)) continue
      const when = item.get('when', true)
      if (isMap(when)) when.flow = true
    }
  }
}

/** Sets one trust threshold - `fallback`, `accept.default`, `bands.probable` - or removes it when empty. */
export function setTrust(doc: Document, path: Path, value: number | undefined): void {
  mapAt(doc, ['trust'])
  if (value === undefined) {
    doc.deleteIn(['trust', ...path])
    for (let depth = path.length - 1; depth >= 1; depth -= 1) {
      const parent = doc.getIn(['trust', ...path.slice(0, depth)], true)
      if (isMap(parent) && parent.items.length === 0) doc.deleteIn(['trust', ...path.slice(0, depth)])
      else break
    }
    const trust = doc.get('trust', true)
    if (isMap(trust) && trust.items.length === 0) doc.delete('trust')
    return
  }
  doc.setIn(['trust', ...path], value)
  const parent = doc.getIn(['trust', ...path.slice(0, -1)], true)
  if (path.length > 1 && isMap(parent)) parent.flow = true
}

/** The conditions of a policy: every key of its `when` but what it is about and its source. */
export const conditionsOf = (policy: PolicyModel): [string, ConditionModel][] =>
  Object.entries(policy.when).filter((entry): entry is [string, ConditionModel] => entry[0] !== 'about' && entry[0] !== 'source' && entry[1] !== undefined)

/** How specific a policy is, as docket ranks it: naming what it is about counts one, and so does each condition. */
export const specificity = (policy: PolicyModel): number => (policy.when.about ? 1 : 0) + conditionsOf(policy).length

/** A condition's operator and value, as the editor shows it. */
export const OPERATORS = ['=', 'not', 'in', 'has', 'gt', 'lt', 'exists', 'matches'] as const
export type Operator = (typeof OPERATORS)[number]
export const OPERATOR_LABELS: Record<Operator, string> = { '=': '=', not: '≠', in: 'in', has: 'has', gt: '>', lt: '<', exists: 'exists', matches: 'matches' }

export function splitCondition(condition: ConditionModel): { op: Operator; value: string } {
  if (typeof condition !== 'object' || condition === null) return { op: '=', value: String(condition) }
  const [op, value] = (Object.entries(condition)[0] ?? ['=', '']) as [Operator, unknown]
  return { op, value: Array.isArray(value) ? value.join(', ') : String(value ?? '') }
}

/** A value typed in a condition's box: a number or a boolean when it reads as one, else text. */
export const conditionValue = (text: string): ConditionValue => {
  const trimmed = text.trim()
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true'
  return trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed
}

export function joinCondition(op: Operator, text: string): ConditionModel {
  if (op === '=') return conditionValue(text)
  if (op === 'in') return { in: text.split(',').map((item) => conditionValue(item)).filter((item) => item !== '') }
  if (op === 'exists') return { exists: text.trim() !== 'false' }
  if (op === 'gt' || op === 'lt') return { [op]: Number(text) }
  if (op === 'matches') return { matches: text.trim() }
  return { [op]: conditionValue(text) } as ConditionModel
}

/** How a condition's field reads: a locator field (`@path`) as "at path". */
export const fieldLabel = (field: string): string => (field.startsWith('@') ? `at ${field.slice(1)}` : field)

/** A condition as one short phrase: `role = lead`, `flags has new-starter`, `at path matches **\/*_test.*`. */
export function conditionText(field: string, condition: ConditionModel): string {
  const { op, value } = splitCondition(condition)
  if (op === 'exists') return `${fieldLabel(field)} ${value === 'false' ? 'is missing' : 'is known'}`
  return `${fieldLabel(field)} ${OPERATOR_LABELS[op]} ${value}`
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)

/** A policy in plain English: "When the source is a person with role = lead, about anything: score 0.85". */
export function sentence(policy: PolicyModel): string {
  const conditions = conditionsOf(policy).map(([field, condition]) => conditionText(field, condition))
  const about = policy.when.about ? `about ${policy.when.about}` : 'about anything'
  const effect =
    policy.adjust !== undefined
      ? `${policy.adjust < 0 ? 'subtract' : 'add'} ${Math.abs(policy.adjust).toFixed(2)}`
      : `score ${(policy.score ?? 0).toFixed(2)}`
  return `When the source is ${article(policy.when.source)}${conditions.length ? ` with ${conditions.join(' and ')}` : ''}, ${about}: ${effect}`
}

/** A number as a score reads: two places. */
export const fmt = (value: number | undefined | null): string => (value === undefined || value === null ? '-' : value.toFixed(2))

/** A signed adjustment, with a real minus sign. */
export const signed = (value: number): string => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`
