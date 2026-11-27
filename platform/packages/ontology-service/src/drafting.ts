// SPDX-License-Identifier: AGPL-3.0-only
import { ICON_NAMES } from '@docket/platform-canonical-store'
import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap } from 'yaml'

import { parseDraft } from './check.js'
import { importYaml } from './yaml-io.js'

/**
 * Drafting a new docket's ontology with AI from a few sentences about the
 * domain. The model never writes YAML: it chooses the closest starting
 * template and answers with the record types, their fields and the
 * relationships it proposes, through one tool call, and the draft is built
 * from that over the template's text, so the template's sources and trust
 * policies come with it. Every draft is then read with docket's loader, and
 * nothing is published until a person reviews it in the ontology editor.
 */

/** A template the model may start from: what New docket's catalogue knows of it. */
export interface StartingPoint {
  /** A built-in template's id, or `org:<uuid>` for one of the org's. */
  id: string
  name: string
  description: string
  types: readonly string[]
  yaml: string
}

export const ATTRIBUTE_KINDS = ['string', 'number', 'boolean', 'string[]', 'number[]'] as const

/** What the model answers with: the starting template and the types and relationships the docket should have. */
export interface DraftPlan {
  template: string
  summary: string
  types: {
    name: string
    description: string
    icon?: string
    attributes: { name: string; type: (typeof ATTRIBUTE_KINDS)[number]; description?: string; values?: string[] }[]
    clues: string[]
  }[]
  relationships: { name: string; description: string; from: string[]; to: string[] }[]
}

/** The most a description may be, in characters. */
export const MAX_DESCRIPTION = 2000
const MAX_TYPES = 30
const MAX_ATTRIBUTES = 20
const MAX_RELATIONSHIPS = 40
const NAME = /^[a-z][a-z0-9_-]{0,47}$/

/** The tool the model drafts through. */
export const DRAFT_TOOL = {
  name: 'draft_ontology',
  description: 'Propose the ontology for the new docket: the template it starts from, and every record type and relationship it should have.',
  parameters: {
    type: 'object',
    required: ['template', 'summary', 'types', 'relationships'],
    properties: {
      template: { type: 'string', description: 'The id of the closest starting template.' },
      summary: { type: 'string', description: 'One sentence: what this docket keeps track of.' },
      types: {
        type: 'array',
        description: 'Every record type the docket should have, including the ones kept from the template.',
        items: {
          type: 'object',
          required: ['name', 'description'],
          properties: {
            name: { type: 'string', description: 'snake_case, singular, e.g. "support_case".' },
            description: { type: 'string', description: 'One sentence: what one record of this type is.' },
            icon: { type: 'string', description: 'A Lucide icon name from the list given, or omit it.' },
            attributes: {
              type: 'array',
              description: 'The facts each record carries, besides its title and description.',
              items: {
                type: 'object',
                required: ['name', 'type'],
                properties: {
                  name: { type: 'string', description: 'snake_case.' },
                  type: { type: 'string', enum: [...ATTRIBUTE_KINDS] },
                  description: { type: 'string' },
                  values: { type: 'array', items: { type: 'string' }, description: 'The allowed values, for a field with a short fixed list.' },
                },
              },
            },
            clues: { type: 'array', items: { type: 'string' }, description: 'Words in text that suggest a record of this type.' },
          },
        },
      },
      relationships: {
        type: 'array',
        description: 'How records of these types point to each other.',
        items: {
          type: 'object',
          required: ['name', 'description', 'from', 'to'],
          properties: {
            name: { type: 'string', description: 'snake_case verb phrase, e.g. "owned_by".' },
            description: { type: 'string' },
            from: { type: 'array', items: { type: 'string' }, description: 'The record types it points from.' },
            to: { type: 'array', items: { type: 'string' }, description: 'The record types it points to.' },
          },
        },
      },
    },
  },
} as const

/** The conversation that asks the model for a draft. */
export function draftMessages(description: string, startingPoints: readonly StartingPoint[]): { role: 'system' | 'user'; content: string }[] {
  const catalogue = startingPoints
    .map((point) => `- ${point.id}: ${point.name}. ${point.description} Types: ${point.types.length ? point.types.join(', ') : 'none'}.`)
    .join('\n')
  return [
    {
      role: 'system',
      content: [
        "You design ontologies for docket, a knowledge base whose records follow an ontology: record types with typed fields, and relationships between types.",
        'Given a description of what a team wants to keep track of, choose the closest starting template and propose the ontology by calling draft_ontology once.',
        '',
        'Rules:',
        '- List every type the docket should have. Keep a template type by repeating its exact name; it keeps its definition, and any fields you give are added to it. Leave out template types the description does not need.',
        '- Names are snake_case and singular, starting with a letter. Prefer 4 to 15 types and only the fields worth recalling.',
        `- Field types are ${ATTRIBUTE_KINDS.join(', ')}. Give values for a field with a short fixed list.`,
        '- Relationships name only types you list.',
        `- Icons, when you give one, come from: ${ICON_NAMES.join(', ')}.`,
        '',
        'Starting templates:',
        catalogue,
      ].join('\n'),
    },
    { role: 'user', content: description.trim().slice(0, MAX_DESCRIPTION) },
  ]
}

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const text = (value: unknown, most = 400): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, most) : '')
const list = (value: unknown, most: number): unknown[] => (Array.isArray(value) ? value.slice(0, most) : [])

/** A name as the ontology takes it: lowercase snake_case; null when nothing is left of it. */
export function ontologyName(raw: unknown): string | null {
  const name = text(raw, 60)
    .toLowerCase()
    .replace(/[\s.]+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48)
  return NAME.test(name) ? name : null
}

/**
 * The model's reply as a plan: its `draft_ontology` call, or a JSON object in
 * its text when it answered without the tool. Null when neither reads as one.
 */
export function readPlan(reply: { content: string; toolCalls: readonly { name: string; arguments: string }[] }, startingPoints: readonly StartingPoint[]): DraftPlan | null {
  const call = reply.toolCalls.find((each) => each.name === DRAFT_TOOL.name)
  const raw = call?.arguments ?? /\{[\s\S]*\}/.exec(reply.content)?.[0]
  if (!raw) return null
  let parsed: Record<string, unknown> | null
  try {
    parsed = asRecord(JSON.parse(raw))
  } catch {
    return null
  }
  if (!parsed) return null
  const template = startingPoints.some((point) => point.id === parsed.template) ? String(parsed.template) : 'blank'
  const types: DraftPlan['types'] = []
  for (const entry of list(parsed.types, MAX_TYPES)) {
    const type = asRecord(entry)
    const name = ontologyName(type?.name)
    if (!type || !name || types.some((each) => each.name === name)) continue
    const attributes: DraftPlan['types'][number]['attributes'] = []
    for (const item of list(type.attributes, MAX_ATTRIBUTES)) {
      const attribute = asRecord(item)
      const field = ontologyName(attribute?.name)
      if (!attribute || !field || attributes.some((each) => each.name === field) || ['title', 'description', 'id', 'type'].includes(field)) continue
      const kind = (ATTRIBUTE_KINDS as readonly unknown[]).includes(attribute.type) ? (attribute.type as DraftPlan['types'][number]['attributes'][number]['type']) : 'string'
      const values = kind === 'string' || kind === 'string[]' ? [...new Set(list(attribute.values, 20).map((value) => text(value, 60)).filter(Boolean))] : []
      const about = text(attribute.description, 200)
      attributes.push({ name: field, type: kind, ...(about ? { description: about } : {}), ...(values.length > 1 ? { values } : {}) })
    }
    const icon = text(type.icon, 40)
    types.push({
      name,
      description: text(type.description) || `A ${name.replace(/[_-]/g, ' ')}.`,
      ...((ICON_NAMES as readonly string[]).includes(icon) ? { icon } : {}),
      attributes,
      clues: [...new Set(list(type.clues, 8).map((clue) => text(clue, 40).toLowerCase()).filter(Boolean))],
    })
  }
  if (!types.length) return null
  const known = new Set(types.map((type) => type.name))
  const relationships: DraftPlan['relationships'] = []
  for (const entry of list(parsed.relationships, MAX_RELATIONSHIPS)) {
    const relationship = asRecord(entry)
    const name = ontologyName(relationship?.name)
    if (!relationship || !name || known.has(name) || relationships.some((each) => each.name === name)) continue
    const ends = (value: unknown) => [...new Set(list(value, MAX_TYPES).map(ontologyName).filter((type): type is string => type !== null && known.has(type)))]
    const from = ends(relationship.from)
    const to = ends(relationship.to)
    if (!from.length || !to.length) continue
    relationships.push({ name, description: text(relationship.description) || `${from.join(', ')} ${name.replace(/[_-]/g, ' ')} ${to.join(', ')}.`, from, to })
  }
  return { template, summary: text(parsed.summary, 300), types, relationships }
}

/** A map node's keys. */
const keysOf = (node: unknown): string[] => (isMap(node) ? node.items.map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key)) : [])

function typeNode(doc: Document, type: DraftPlan['types'][number], kept: unknown): unknown {
  const attributes = Object.fromEntries(
    type.attributes.map((attribute) => [
      attribute.name,
      { type: attribute.type, ...(attribute.values ? { enum: attribute.values } : {}), ...(attribute.description ? { description: attribute.description } : {}) },
    ]),
  )
  if (isMap(kept)) {
    // A template type keeps its definition; the plan's fields are added to it.
    const node = kept.clone() as YAMLMap
    const existing = node.get('attributes', true)
    const have = keysOf(existing)
    const added = Object.entries(attributes).filter(([name]) => !have.includes(name))
    if (added.length) {
      if (isMap(existing)) for (const [name, value] of added) existing.set(name, doc.createNode(value))
      else node.set('attributes', doc.createNode(Object.fromEntries(added)))
    }
    return node
  }
  return doc.createNode({
    description: type.description,
    ...(type.icon ? { icon: type.icon } : {}),
    ...(type.attributes.length ? { attributes } : {}),
    extraction: {
      instructions: `Capture a ${type.name.replace(/[_-]/g, ' ')} when one is named with something worth recalling about it.`,
      ...(type.clues.length ? { clues: type.clues } : {}),
    },
  })
}

/**
 * The draft's text: the starting template's, with its record types and
 * relationships replaced by the plan's and the trust policies about what it
 * no longer has dropped. Throws `OntologyInvalid` when the result is not an
 * ontology docket reads.
 */
export function buildDraft(plan: DraftPlan, start: StartingPoint): string {
  const doc = parseDocument(start.yaml)
  const templateTypes = doc.get('resourceTypes', true)
  const templateRelationships = doc.get('relationships', true)
  const types = doc.createNode({}) as YAMLMap
  for (const type of plan.types) types.set(type.name, typeNode(doc, type, isMap(templateTypes) ? templateTypes.get(type.name, true) : undefined))
  const relationships = doc.createNode({}) as YAMLMap
  for (const relationship of plan.relationships) {
    const kept = isMap(templateRelationships) ? templateRelationships.get(relationship.name, true) : undefined
    const node = isMap(kept) ? (kept.clone() as YAMLMap) : (doc.createNode({ description: relationship.description }) as YAMLMap)
    node.set('from', doc.createNode(relationship.from))
    node.set('to', doc.createNode(relationship.to))
    relationships.set(relationship.name, node)
  }
  doc.set('resourceTypes', types)
  doc.set('relationships', relationships)
  // What the docket keeps is all a policy or acceptance bar may name.
  const named = new Set([...plan.types.map((type) => type.name), ...plan.relationships.map((relationship) => relationship.name)])
  const policies = doc.getIn(['trust', 'policies'], true)
  if (isSeq(policies)) {
    policies.items = policies.items.filter((policy) => {
      const about = isMap(policy) ? policy.getIn(['when', 'about']) : undefined
      return about === undefined || named.has(String(about))
    })
  }
  const accept = doc.getIn(['trust', 'accept'], true)
  if (isMap(accept)) accept.items = accept.items.filter((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key) === 'default' || named.has(String(isScalar(pair.key) ? pair.key.value : pair.key)))
  doc.commentBefore = [
    ` Drafted by AI${plan.summary ? `: ${plan.summary}` : ''}`,
    ` Started from the ${start.name} template, whose sources and trust policies it keeps.`,
    ' Review every type and relationship before you create the docket.',
  ].join('\n')
  const yaml = importYaml(doc.toString()).yaml
  parseDraft(yaml)
  return yaml
}
