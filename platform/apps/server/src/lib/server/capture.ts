// SPDX-License-Identifier: AGPL-3.0-only
import {
  EVIDENCE_LOCATION_FIELDS,
  confidenceModel,
  type Diagnostic,
  type EvidenceInput,
  type Ontology,
  type Writer,
} from '@docket/platform-canonical-store'
import { error, type RequestEvent } from '@sveltejs/kit'

import type { CaptureAttribute, CaptureVocabulary } from '$lib/graph/capture'

import { formText } from './workspace'

/**
 * The graph browser's capture forms (§14.2): new resource, add link, add
 * evidence. They post the same structured write the MCP tools make, as the
 * signed-in member, and the evidence form is shaped by the chosen source's
 * `requires` fields.
 */

const attributesOf = (definitions: Record<string, { type: string; enum?: (string | number)[]; description?: string }> | undefined): CaptureAttribute[] =>
  Object.entries(definitions ?? {}).map(([name, definition]) => ({
    name,
    type: definition.type,
    enum: definition.enum ?? null,
    description: definition.description ?? null,
  }))

export function captureVocabulary(ontology: Ontology | null): CaptureVocabulary {
  if (!ontology) return { types: [], relationships: [], sources: [], locationFields: [...EVIDENCE_LOCATION_FIELDS] }
  const model = confidenceModel(ontology)
  return {
    types: Object.entries(ontology.resourceTypes)
      .map(([name, type]) => ({ name, description: type.description ?? null, attributes: attributesOf(type.attributes) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: Object.entries(ontology.relationships)
      .map(([name, relationship]) => ({ name, description: relationship.description ?? null, from: relationship.from, to: relationship.to }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    sources: Object.entries(model.sources).map(([name, source]) => ({
      name,
      description: source.description ?? null,
      requires: Object.entries(source.locator ?? {}).filter(([, locator]) => locator.required).map(([name]) => name),
      requiresAny: [...(source.requiresAny ?? [])],
    })),
    locationFields: [...EVIDENCE_LOCATION_FIELDS],
  }
}

/** The signed-in member as a writer: evidence names them by their GitHub login, through the web, acting for themselves. */
export function webWriter(event: RequestEvent, workspaceId: string): Writer {
  const user = event.locals.user
  if (!user) error(401, 'Sign in first.')
  return { workspaceId, actor: `user:${user.id}`, label: `${user.login} (web)`, channel: 'ui', requestId: event.locals.requestId, principal: user.login }
}

const field = (form: FormData, name: string) => formText(form, name).trim()

/** The one evidence entry a capture form carries: `evidence.source`, its location fields, a note and a date. */
export function evidenceFromForm(form: FormData): EvidenceInput[] {
  const source = field(form, 'evidence.source')
  if (!source) return []
  const entry: EvidenceInput = { source }
  for (const name of EVIDENCE_LOCATION_FIELDS) {
    const value = field(form, `evidence.${name}`)
    if (!value) continue
    if (name === 'urls') entry.urls = value.split(/\s+/).filter(Boolean).slice(0, 10)
    else entry[name] = value.slice(0, name === 'endpoint' || name === 'repository' ? 2000 : 500)
  }
  const note = field(form, 'evidence.note')
  if (note) entry.note = note.slice(0, 1000)
  const observedAt = field(form, 'evidence.observedAt')
  if (/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) entry.observedAt = observedAt
  return [entry]
}

/**
 * Attribute values from `attr.<name>` fields, typed as the ontology declares
 * them. Empty fields are left out; a value that does not read as its type is
 * a problem for the form to show.
 */
export function attributesFromForm(form: FormData, attributes: readonly CaptureAttribute[]): { values: Record<string, unknown>; problems: Diagnostic[] } {
  const values: Record<string, unknown> = {}
  const problems: Diagnostic[] = []
  for (const attribute of attributes) {
    const raw = field(form, `attr.${attribute.name}`)
    if (attribute.type === 'boolean') {
      if (raw === 'true' || raw === 'false') values[attribute.name] = raw === 'true'
      continue
    }
    if (!raw) continue
    const list = raw.split(',').map((item) => item.trim()).filter(Boolean)
    const number = (text: string) => (text !== '' && Number.isFinite(Number(text)) ? Number(text) : null)
    if (attribute.type === 'number') {
      const value = number(raw)
      if (value === null) problems.push({ severity: 'error', code: 'attribute-type-mismatch', message: `${attribute.name} must be a number.` })
      else values[attribute.name] = value
    } else if (attribute.type === 'number[]') {
      const numbers = list.map(number)
      if (numbers.some((value) => value === null)) problems.push({ severity: 'error', code: 'attribute-type-mismatch', message: `${attribute.name} must be numbers, separated by commas.` })
      else values[attribute.name] = numbers
    } else if (attribute.type === 'string[]') {
      values[attribute.name] = list
    } else {
      values[attribute.name] = raw
    }
  }
  return { values, problems }
}

/** Diagnostics as a form shows them. */
export const shown = (diagnostics: readonly Diagnostic[]) => diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))
