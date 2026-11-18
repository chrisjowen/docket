import { DEFAULT_SEARCH_LIMIT } from '../../commands/search.js'
import { InvalidArgumentsError } from '../../workspace/docket.js'
import { DISPOSITIONS, type Disposition } from '../../workspace/ontology/check.js'
import { MIGRATION_OPS, type Migration } from '../../workspace/ontology/migrations.js'
import type { Proposal } from '../../workspace/ontology/propose.js'
import { MAX_ONTOLOGY_BYTES } from '../../workspace/ontology/yaml-io.js'
import { WRITE_LIMITS, type AddEvidenceInput, type AppendNotesInput, type EvidenceInput, type LinkInput, type RememberInput } from '../../workspace/write/inputs.js'
import { MAX_SEARCH_LIMIT } from '../search.js'
import { argumentsOf, isObject } from './args.js'
import { MAX_ASK_RESULTS, MAX_QUESTION } from './definitions.js'
import { searchScope, type SearchBackend } from './results.js'
import { optionalText, parseAttributes, parseEvidence, requiredText } from './write-args.js'

/*
 * Each tool's arguments, checked as every Docket MCP server checks them:
 * arguments a tool does not take, or of the wrong shape, are JSON-RPC's
 * invalid params (`InvalidArgumentsError`); what they say is the store's to
 * judge.
 */

export interface SearchArguments {
  query: string
  limit: number
  include?: SearchBackend[]
  minConfidence?: number
}

export function searchArguments(raw: unknown): SearchArguments {
  const args = argumentsOf(
    'docket_search',
    raw,
    ['query', 'limit', 'project', 'include', 'minConfidence'],
    '{ "query": "...", "limit"?: n, "project"?: "...", "include"?: ["facts" | "graph" | "timeline"], "minConfidence"?: n }'
  )
  if (args.project !== undefined && typeof args.project !== 'string') throw new InvalidArgumentsError('project must be a string.')
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new InvalidArgumentsError('Say what to look for: query is empty.')
  const limit = args.limit ?? DEFAULT_SEARCH_LIMIT
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new InvalidArgumentsError(`limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}.`)
  }
  const scope = searchScope(args.include, args.minConfidence)
  if (typeof scope === 'string') throw new InvalidArgumentsError(scope)
  return { query, limit, ...scope }
}

export function getArguments(raw: unknown): { id: string } {
  const args = argumentsOf('docket_get', raw, ['id'], '{ "id": "..." }')
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (!id || id.length > 200) throw new InvalidArgumentsError('Give the id of a resource, as docket_search returns it.')
  return { id }
}

export function askArguments(raw: unknown): { question: string; maxResults?: number } {
  const args = argumentsOf('docket_ask', raw, ['question', 'maxResults'], '{ "question": "...", "maxResults"?: n }')
  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question) throw new InvalidArgumentsError('Ask something: the question is empty.')
  if (question.length > MAX_QUESTION) throw new InvalidArgumentsError(`Keep the question under ${MAX_QUESTION} characters.`)
  const maxResults = args.maxResults
  if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_ASK_RESULTS)) {
    throw new InvalidArgumentsError(`maxResults must be a whole number from 1 to ${MAX_ASK_RESULTS}.`)
  }
  return { question, ...(maxResults !== undefined ? { maxResults } : {}) }
}

export function ontologyArguments(raw: unknown): void {
  argumentsOf('docket_ontology', raw, [], '{}')
}

const dryRunOf = (value: unknown): boolean => {
  if (value !== undefined && typeof value !== 'boolean') throw new InvalidArgumentsError('dryRun must be true or false.')
  return value === true
}

function linksOf(raw: unknown): LinkInput[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new InvalidArgumentsError('links must be an array of { "rel", "target", "evidence" }.')
  if (raw.length > WRITE_LIMITS.linksPerResource) throw new InvalidArgumentsError(`links holds at most ${WRITE_LIMITS.linksPerResource} links.`)
  return raw.map((link, index) => {
    const at = `links[${index}]`
    if (!isObject(link)) throw new InvalidArgumentsError(`${at} must be an object with rel and target.`)
    const unknown = Object.keys(link).filter((key) => !['rel', 'target', 'attributes', 'evidence'].includes(key))
    if (unknown.length) throw new InvalidArgumentsError(`${at} does not take ${unknown.map((key) => `"${key}"`).join(', ')}.`)
    const attributes = parseAttributes(link.attributes, `${at}.attributes`)
    return {
      rel: requiredText(link.rel, `${at}.rel`, 100),
      target: requiredText(link.target, `${at}.target`, 200),
      ...(attributes ? { attributes } : {}),
      evidence: parseEvidence(link.evidence, `${at}.evidence`)
    }
  })
}

export function rememberArguments(raw: unknown): { input: RememberInput; dryRun: boolean } {
  const args = argumentsOf('docket_remember', raw, ['id', 'type', 'title', 'attributes', 'body', 'links', 'evidence', 'dryRun'], '{ "id", "type", "title", "evidence": [...], ... }')
  const dryRun = dryRunOf(args.dryRun)
  const attributes = parseAttributes(args.attributes, 'attributes')
  const body = optionalText(args.body, 'body', 60000)
  const links = linksOf(args.links)
  const input: RememberInput = {
    id: requiredText(args.id, 'id', 200),
    type: requiredText(args.type, 'type', 100),
    title: requiredText(args.title, 'title', 200),
    ...(attributes ? { attributes } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(links ? { links } : {}),
    evidence: parseEvidence(args.evidence, 'evidence')
  }
  return { input, dryRun }
}

export function updateNotesArguments(raw: unknown): { input: AppendNotesInput; dryRun: boolean } {
  const args = argumentsOf('docket_update_notes', raw, ['id', 'additional_notes', 'evidence', 'dryRun'], '{ "id", "additional_notes", "evidence": [...] }')
  const dryRun = dryRunOf(args.dryRun)
  return {
    input: {
      id: requiredText(args.id, 'id', 200),
      additionalNotes: requiredText(args.additional_notes, 'additional_notes', 60000),
      evidence: parseEvidence(args.evidence, 'evidence')
    },
    dryRun
  }
}

export function addEvidenceArguments(raw: unknown): AddEvidenceInput {
  const args = argumentsOf('docket_add_evidence', raw, ['id', 'link', 'evidence'], '{ "id", "evidence": [...], "link"?: { "rel", "target" } }')
  let link: AddEvidenceInput['link']
  if (args.link !== undefined) {
    if (!isObject(args.link) || Object.keys(args.link).some((key) => key !== 'rel' && key !== 'target')) {
      throw new InvalidArgumentsError('link must be { "rel": "...", "target": "..." }.')
    }
    link = { rel: requiredText(args.link.rel, 'link.rel', 100), target: requiredText(args.link.target, 'link.target', 200) }
  }
  return { id: requiredText(args.id, 'id', 200), ...(link ? { link } : {}), evidence: parseEvidence(args.evidence, 'evidence') }
}

export function retireArguments(raw: unknown): { id: string; reason: string } {
  const args = argumentsOf('docket_retire', raw, ['id', 'reason'], '{ "id": "...", "reason": "..." }')
  return { id: requiredText(args.id, 'id', 200), reason: requiredText(args.reason, 'reason', WRITE_LIMITS.reasonLength) }
}

/** `docket_supersede`'s arguments. */
export interface SupersedeInput {
  /** The record gone out of date. */
  id: string
  /** The record that replaces it. */
  by: string
  reason: string
  evidence: EvidenceInput[]
  /** Until when the older record held: `YYYY-MM-DD` or an ISO timestamp; now when not given. */
  validUntil?: string
}

export function supersedeArguments(raw: unknown): SupersedeInput {
  const args = argumentsOf(
    'docket_supersede',
    raw,
    ['id', 'by', 'reason', 'validUntil', 'evidence'],
    '{ "id": "...", "by": "...", "reason": "...", "evidence": [...], "validUntil"?: "YYYY-MM-DD" }'
  )
  const validUntil = optionalText(args.validUntil, 'validUntil', 40)?.trim()
  return {
    id: requiredText(args.id, 'id', 200),
    by: requiredText(args.by, 'by', 200),
    reason: requiredText(args.reason, 'reason', WRITE_LIMITS.reasonLength),
    evidence: parseEvidence(args.evidence, 'evidence'),
    ...(validUntil ? { validUntil } : {})
  }
}

export function proposalArguments(raw: unknown): Proposal {
  const args = argumentsOf('docket_propose_ontology_change', raw, ['patch', 'yaml', 'message'], '{ "patch": "..." } or { "yaml": "..." }')
  const patch = optionalText(args.patch, 'patch', MAX_ONTOLOGY_BYTES)
  const yaml = optionalText(args.yaml, 'yaml', MAX_ONTOLOGY_BYTES)
  const message = optionalText(args.message, 'message', 500)
  if ((patch === undefined) === (yaml === undefined)) throw new InvalidArgumentsError('Give either patch or yaml, not both.')
  return patch !== undefined ? { patch, ...(message ? { message } : {}) } : { yaml: yaml as string, ...(message ? { message } : {}) }
}

/** What `docket_publish_ontology_change` takes: a proposal, and what an editor's publish takes with it. */
export type DirectChange = Proposal & {
  /** The head the caller read and means to change: refused as stale when another version was published since. */
  expectedHead?: number
  migration?: Migration[]
  /** Accept resources that gain diagnostics, as an editor's "publish anyway" does. */
  acceptNarrowing?: boolean
  /** By resource id: what to do with each resource a breaking change leaves unknown. */
  dispositions?: Readonly<Record<string, Disposition>>
}

const PUBLISH_ARGUMENTS = ['patch', 'yaml', 'message', 'expectedHead', 'migration', 'acceptNarrowing', 'dispositions']

function migrationOf(value: unknown): Migration[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 50) throw new InvalidArgumentsError('migration is a list of at most 50 steps.')
  return value.map((step, index) => {
    if (!isObject(step) || !MIGRATION_OPS.includes(step.op as Migration['op'])) {
      throw new InvalidArgumentsError(`migration[${index}].op is one of ${MIGRATION_OPS.join(', ')}.`)
    }
    const unknown = Object.keys(step).filter((key) => !['op', 'from', 'to', 'type'].includes(key))
    if (unknown.length) throw new InvalidArgumentsError(`migration[${index}] does not take ${unknown.map((key) => `"${key}"`).join(', ')}.`)
    const from = optionalText(step.from, `migration[${index}].from`, 100)
    const to = optionalText(step.to, `migration[${index}].to`, 100)
    const type = optionalText(step.type, `migration[${index}].type`, 100)
    if (!from) throw new InvalidArgumentsError(`migration[${index}].from must be a non-empty string.`)
    return { op: step.op as Migration['op'], from, ...(to ? { to } : {}), ...(type ? { type } : {}) }
  })
}

function dispositionsOf(value: unknown): Record<string, Disposition> | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) throw new InvalidArgumentsError('dispositions maps resource ids to accept-data-loss or update-in-repo.')
  const entries = Object.entries(value)
  if (entries.length > 1000) throw new InvalidArgumentsError('dispositions names at most 1000 resources.')
  for (const [id, disposition] of entries) {
    if (!DISPOSITIONS.includes(disposition as Disposition)) throw new InvalidArgumentsError(`dispositions["${id.slice(0, 100)}"] is one of ${DISPOSITIONS.join(', ')}.`)
  }
  return value as Record<string, Disposition>
}

export function publishArguments(raw: unknown): DirectChange {
  const args = argumentsOf(
    'docket_publish_ontology_change',
    raw,
    PUBLISH_ARGUMENTS,
    '{ "patch": "..." } or { "yaml": "..." }, with message, expectedHead, migration, acceptNarrowing or dispositions'
  )
  const patch = optionalText(args.patch, 'patch', MAX_ONTOLOGY_BYTES)
  const yaml = optionalText(args.yaml, 'yaml', MAX_ONTOLOGY_BYTES)
  const message = optionalText(args.message, 'message', 500)
  if ((patch === undefined) === (yaml === undefined)) throw new InvalidArgumentsError('Give either patch or yaml, not both.')
  const { expectedHead, acceptNarrowing } = args
  if (expectedHead !== undefined && (typeof expectedHead !== 'number' || !Number.isInteger(expectedHead) || expectedHead < 0)) {
    throw new InvalidArgumentsError('expectedHead is a version number.')
  }
  if (acceptNarrowing !== undefined && typeof acceptNarrowing !== 'boolean') throw new InvalidArgumentsError('acceptNarrowing is true or false.')
  const migration = migrationOf(args.migration)
  const dispositions = dispositionsOf(args.dispositions)
  return {
    ...(patch !== undefined ? { patch } : { yaml: yaml as string }),
    ...(message ? { message } : {}),
    ...(expectedHead !== undefined ? { expectedHead } : {}),
    ...(migration ? { migration } : {}),
    ...(acceptNarrowing ? { acceptNarrowing } : {}),
    ...(dispositions ? { dispositions } : {})
  }
}
