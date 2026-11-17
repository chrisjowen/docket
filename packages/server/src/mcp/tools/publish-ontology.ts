import { InvalidArgumentsError, type Tool } from '@chrisjowen/docket'

import { DISPOSITIONS, type Disposition } from '../../ontology/check.js'
import { MigrationInvalid, OntologyBreakingChange, OntologyInvalid, OntologyNarrowingChange, OntologyWriteDisabled, StaleDraft, isBreaking } from '../../ontology/errors.js'
import { MIGRATION_OPS, describeMigration, type Migration } from '../../ontology/migrations.js'
import { MAX_ONTOLOGY_BYTES } from '../../ontology/yaml-io.js'
import { publishOntologyChange, type DirectChange } from '../../postgres/ontology.js'
import { argumentsOf, isObject } from '../args.js'
import { failed, type ServerTool, type ToolContext } from '../context.js'
import { optionalText } from '../write-args.js'

const DEFINITION = {
  name: 'docket_publish_ontology_change',
  title: 'Publish an ontology change',
  description:
    "Change this workspace's ontology directly: publishes the next version, with no review, through the web editor's " +
    'publish path - every document is re-checked, a migration rewrites the documents it names, and the version is ' +
    'recorded in the ontology history, where an admin can roll it back. Give either patch, a YAML merge patch onto ' +
    'the published ontology (a mapping merges key by key; null removes a key), or yaml, a whole ontology. A change ' +
    'that breaks resources (a type or relationship they use goes away) needs a migration that resolves them, or a ' +
    'disposition for each; one that gives resources new diagnostics needs acceptNarrowing. Try ' +
    'docket_propose_ontology_change first to see what a change does. Offered only where the workspace owner lets your ' +
    'role change the ontology over MCP.',
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'YAML merge patch onto the published ontology, for example "resourceTypes:\\n  queue:\\n    description: A message queue.\\n".' },
      yaml: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'A whole ontology (entities.yaml), instead of a patch.' },
      message: { type: 'string', maxLength: 500, description: "Why: kept with the version in the ontology history." },
      expectedHead: { type: 'integer', minimum: 0, description: 'The version you read and are changing (docket_ontology names it): refused if another was published since.' },
      migration: {
        type: 'array',
        maxItems: 50,
        description: 'Steps that carry existing documents across a breaking change, rewriting cloud documents as new revisions.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: [...MIGRATION_OPS], description: 'renameType or mapType (from a type to another the new ontology has), renameRelationship, or dropAttribute (from an attribute of type).' },
            from: { type: 'string', maxLength: 100 },
            to: { type: 'string', maxLength: 100 },
            type: { type: 'string', maxLength: 100, description: 'For dropAttribute: the type the attribute is dropped from.' }
          },
          required: ['op', 'from'],
          additionalProperties: false
        }
      },
      acceptNarrowing: { type: 'boolean', description: 'Publish even though existing resources gain diagnostics.' },
      dispositions: {
        type: 'object',
        description: 'By resource id, for each resource the change still leaves unknown after the migration: accept-data-loss, or update-in-repo for a repo or CLI document a migration step covers.',
        additionalProperties: { type: 'string', enum: [...DISPOSITIONS] }
      }
    },
    additionalProperties: false
  },
  annotations: { title: 'Publish an ontology change', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
}

const ALLOWED = ['patch', 'yaml', 'message', 'expectedHead', 'migration', 'acceptNarrowing', 'dispositions']

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

/** The arguments as the ontology service takes them, or an invalid-params error. */
function changeOf(raw: unknown): DirectChange {
  const args = argumentsOf('docket_publish_ontology_change', raw, ALLOWED, '{ "patch": "..." } or { "yaml": "..." }, with message, expectedHead, migration, acceptNarrowing or dispositions')
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

/** Why the publish was refused, for the model to read; nothing was published. */
function refusalOf(caught: unknown): string | null {
  if (caught instanceof OntologyInvalid) {
    return `The change is not a valid ontology; nothing was published:\n${caught.diagnostics.map((d) => `- ${d.code}: ${d.message}`).join('\n')}`
  }
  if (caught instanceof OntologyWriteDisabled) return `Nothing was published: ${caught.message}. Propose the change with docket_propose_ontology_change instead.`
  if (caught instanceof StaleDraft) return `Nothing was published: ${caught.message}. Read the ontology again with docket_ontology and make the change against it.`
  if (caught instanceof MigrationInvalid) return `Nothing was published: the migration cannot apply. ${caught.message}`
  if (caught instanceof OntologyBreakingChange) {
    const broken = caught.check.introduced.filter(isBreaking).slice(0, 20)
    return [
      `Nothing was published: ${caught.message}.`,
      'Resolve each with a migration step (renameType, mapType, renameRelationship), or give it a disposition (accept-data-loss, or update-in-repo for a repo document a step covers):',
      ...broken.map((d) => `- ${d.id ?? d.path ?? ''}: ${d.message}`)
    ].join('\n')
  }
  if (caught instanceof OntologyNarrowingChange) {
    return [
      `Nothing was published: ${caught.message} (acceptNarrowing: true).`,
      ...caught.check.introduced.slice(0, 20).map((d) => `- ${d.code} ${d.id ?? d.path ?? ''}: ${d.message}`)
    ].join('\n')
  }
  return null
}

/**
 * `docket_publish_ontology_change`: publishes the ontology directly, where
 * the workspace's owner allows the caller's role to (an editor's publish,
 * over MCP). Needs `ontology:write`, which is effective only while the setting
 * names the caller's role; the publish re-reads it under its own locks.
 */
export function publishOntologyTool(context: ToolContext): ServerTool {
  const tool: Tool = {
    definition: DEFINITION,
    async call(raw) {
      const change = changeOf(raw)
      const writer = await context.writer()
      const role = await context.role()
      let published
      try {
        published = await context.audited(async (ctx) => {
          const value = await publishOntologyChange(ctx, writer, role, change)
          return { value, outcome: 'ok', target: [`ontology:v${value.number}`, ...value.rewritten.map((document) => document.resourceId)] }
        })
      } catch (caught) {
        const refused = refusalOf(caught)
        if (refused === null) throw caught
        return failed(refused)
      }
      const number = published.number ?? 0
      const check = published.checkResult
      const lines = [
        `Published v${number}${published.parentNumber ? ` (was v${published.parentNumber})` : ''}: ${check?.classification ?? 'safe'}.`,
        published.rewritten.length ? `The migration rewrote ${published.rewritten.length} document(s).` : 'No documents were rewritten.',
        ...(published.migration?.length ? [`Migration: ${published.migration.map(describeMigration).join(', ')}.`] : []),
        `It is in the ontology history, where an admin can roll it back: ${context.ontologyHistory}`
      ]
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          schema: 'docket-ontology-publish.v1',
          version: number,
          previous: published.parentNumber ?? 0,
          classification: check?.classification ?? 'safe',
          rewritten: published.rewritten.map((document) => ({ resourceId: document.resourceId, path: document.path, revision: document.revision })),
          migration: published.migration ?? [],
          dispositions: (published.dispositions ?? []).map(({ resourceId, disposition }) => ({ resourceId, disposition })),
          history: context.ontologyHistory
        }
      }
    }
  }
  return { scope: 'ontology:write', tool }
}
