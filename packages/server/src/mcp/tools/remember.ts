import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'

import { writeResource } from '../../postgres/write.js'
import { hasErrors } from '../../write/evidence.js'
import { WRITE_LIMITS, type LinkInput, type RememberInput } from '../../write/inputs.js'
import { argumentsOf, isObject } from '../args.js'
import type { ServerTool, ToolContext } from '../context.js'
import { EVIDENCE_SCHEMA, optionalText, parseAttributes, parseEvidence, requiredText, writeAnswer } from '../write-args.js'

const DEFINITION = {
  name: 'docket_remember',
  title: 'Remember a resource, with evidence',
  description:
    "Write one resource into this workspace's docket, or add to it: its type, title, attributes, body and links, with " +
    'evidence for each. A new resource needs at least one evidence entry, every link the resource does not have yet ' +
    'needs its own, and every write carries some. The write is checked against the published ontology (call docket_ontology first for the types, relationships ' +
    'and evidence sources it accepts): an error refuses it with the reasons, warnings come back with it. Writing the ' +
    'same thing again adds nothing. Use dryRun to check a write without making it.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id, conventionally <type>.<slug>, for example service.orders.' },
      type: { type: 'string', minLength: 1, maxLength: 100, description: 'A resource type the ontology registers.' },
      title: { type: 'string', minLength: 1, maxLength: 200, description: 'A short human title.' },
      attributes: { type: 'object', description: 'Attribute values, as the ontology declares them for the type. Given keys replace earlier values.' },
      body: { type: 'string', maxLength: 60000, description: 'Narrative Markdown notes about this resource. Write in prose as you would explain it to a colleague: what it is, how it relates to others, anything notable you observed, and your reasoning. Prefer 2-5 substantial paragraphs over a list of attributes (those go in attributes). This body replaces the earlier one. To add to existing notes safely, use docket_update_notes with only the new prose and its evidence.' },
      links: {
        type: 'array',
        maxItems: WRITE_LIMITS.linksPerResource,
        description: 'Relationships from this resource. A new link needs its own evidence.',
        items: {
          type: 'object',
          properties: {
            rel: { type: 'string', minLength: 1, maxLength: 100, description: 'A relationship the ontology registers, for example depends_on.' },
            target: { type: 'string', minLength: 1, maxLength: 200, description: 'The id of the resource it points at.' },
            attributes: { type: 'object', description: 'Relationship attributes, as the ontology declares them.' },
            evidence: { type: 'array', maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA }
          },
          required: ['rel', 'target'],
          additionalProperties: false
        }
      },
      evidence: { type: 'array', maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA, description: 'Evidence for the resource itself: at least one entry for a new resource.' },
      dryRun: { type: 'boolean', description: 'Check the write and return what it would say, without writing.' }
    },
    required: ['id', 'type', 'title', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Remember a resource, with evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

function parseLinks(raw: unknown): LinkInput[] | undefined {
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

/** `docket_remember`: upsert one resource with links, evidence required, checked against the published ontology. */
export function rememberTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const args = argumentsOf('docket_remember', raw, ['id', 'type', 'title', 'attributes', 'body', 'links', 'evidence', 'dryRun'], '{ "id", "type", "title", "evidence": [...], ... }')
      if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new InvalidArgumentsError('dryRun must be true or false.')
      const attributes = parseAttributes(args.attributes, 'attributes')
      const body = optionalText(args.body, 'body', 60000)
      const links = parseLinks(args.links)
      const input: RememberInput = {
        id: requiredText(args.id, 'id', 200),
        type: requiredText(args.type, 'type', 100),
        title: requiredText(args.title, 'title', 200),
        ...(attributes ? { attributes } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(links ? { links } : {}),
        evidence: parseEvidence(args.evidence, 'evidence')
      }
      const dryRun = args.dryRun === true
      const writer = await context.writer()
      const result = await context.audited(async (ctx) => {
        const value = await writeResource(ctx, writer, input, { dryRun })
        return { value, outcome: hasErrors(value.diagnostics) ? 'invalid' : 'ok', target: [input.id] }
      })
      return writeAnswer('docket_remember', input.id, context.viewer, result, dryRun)
    }
  }
  return { scope: 'docket:write', tool }
}
