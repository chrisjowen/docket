import { DEFAULT_SEARCH_LIMIT } from '../../commands/search.js'
import { DISPOSITIONS } from '../../workspace/ontology/check.js'
import { MIGRATION_OPS } from '../../workspace/ontology/migrations.js'
import { MAX_ONTOLOGY_BYTES } from '../../workspace/ontology/yaml-io.js'
import { WRITE_LIMITS } from '../../workspace/write/inputs.js'
import { MAX_SEARCH_LIMIT } from '../search.js'
import type { ToolDefinition } from '../server.js'
import { SEARCH_BACKENDS } from './results.js'
import { EVIDENCE_SCHEMA } from './write-args.js'

/*
 * Docket's MCP surface: the tools every Docket MCP server offers - the local
 * CLI's (`docket open`'s `/mcp`), a self-hosted server and Docket Cloud - with
 * the same names, input schemas, annotations and result shapes, defined once,
 * here. A host words a tool's description for where it runs; everything else
 * a client relies on is this. `surfaceOf` is what must not drift, and each
 * host's tests compare its tools with it.
 */

/** `docket_search`'s app: the matches and their links on the casebook's evidence board. */
export const APP_URI = 'ui://docket/search.html'

/** The most characters of a `docket_ask` question. */
export const MAX_QUESTION = 2_000
/** The most results `docket_ask` asks of each projection. */
export const MAX_ASK_RESULTS = 50

const SEARCH_DESCRIPTION =
  "Search this project's docket - its typed project knowledge (services, decisions, constraints, owners, " +
  'dependencies) - for the resources that match a query. Returns each match with its canonical file and its ' +
  'links, the paths and relationships the projections returned with why they hold, and draws them, with the ' +
  'resources one link away as context, as a graph.'

export const SEARCH_DEFINITION = {
  name: 'docket_search',
  title: 'Search the docket',
  description:
    `${SEARCH_DESCRIPTION} Searches the workspace's facts, the graph the projections return and its timeline at once, ` +
    'each resource once, tagged with where it was found. A re-ranker reads the query with each result and only the relevant ones come back, ' +
    'most relevant first: often fewer than limit, and none when the workspace holds nothing that answers the query. ' +
    'Each result shows its confidence (how well its evidence supports it), which never decides what is returned.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'What to look for, in words: a name, a topic or a question.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_SEARCH_LIMIT,
        default: DEFAULT_SEARCH_LIMIT,
        description: 'Hits asked of each projection.'
      },
      project: {
        type: 'string',
        description: 'The project the host means, such as the Wheelhouse project id it routes the call by. Each server searches one docket, so it is not used.'
      },
      include: {
        type: 'array',
        items: { type: 'string', enum: [...SEARCH_BACKENDS] },
        minItems: 1,
        description: 'Where to look: the facts the projections hold, the graph they return, the activity timeline. All three when omitted.'
      },
      minConfidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        deprecated: true,
        description: 'Ignored: relevance decides what is returned; confidence is shown with each result.'
      }
    },
    required: ['query'],
    additionalProperties: false
  },
  annotations: { title: 'Search the docket', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: APP_URI } }
} satisfies ToolDefinition

/** `docket_search`'s description before a host says how it ranks: what docket's own search does. */
export const SEARCH_BASE_DESCRIPTION = SEARCH_DESCRIPTION

export const GET_DEFINITION = {
  name: 'docket_get',
  title: 'Read one resource',
  description:
    "Read one resource of this workspace's docket by its id (for example service.orders): its merged frontmatter and " +
    'body, its links, every piece of evidence with the confidence it supports, the documents that declare it, and ' +
    'their revision history, and whether it has gone out of date: the record that superseded it, since when and why. ' +
    'Call docket_search first to find ids.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id, as docket_search returns it.' } },
    required: ['id'],
    additionalProperties: false
  },
  annotations: { title: 'Read one resource', readOnlyHint: true, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

export const ASK_DEFINITION = {
  name: 'docket_ask',
  title: 'Ask the docket',
  description:
    "Ask a question about this workspace's knowledge in words. docket puts it to every projection (the graph and " +
    'semantic memory), checks each answer against the canonical documents, and has a model write a short answer ' +
    "that cites the resources and evidence it relies on. Uses the organisation's AI budget; docket_search does not.",
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION, description: 'The question, in words.' },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_ASK_RESULTS, description: 'Results asked of each projection.' }
    },
    required: ['question'],
    additionalProperties: false
  },
  annotations: { title: 'Ask the docket', readOnlyHint: true, idempotentHint: false, openWorldHint: false }
} satisfies ToolDefinition

export const ONTOLOGY_DEFINITION = {
  name: 'docket_ontology',
  title: "Read the workspace's ontology",
  description:
    "Read this workspace's published ontology: its resource types and their attributes, the relationships between " +
    'them, the evidence sources it accepts with the location each requires, and its extraction guidance, with its ' +
    'version number. Read it before writing knowledge, so a write fits the types and evidence the workspace expects.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: "Read the workspace's ontology", readOnlyHint: true, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

export const REMEMBER_DEFINITION = {
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
      body: {
        type: 'string',
        maxLength: 60000,
        description:
          'Narrative Markdown notes about this resource. Write in prose as you would explain it to a colleague: what it is, how it relates to others, anything notable you observed, and your reasoning. Prefer 2-5 substantial paragraphs over a list of attributes (those go in attributes). This body replaces the earlier one. To add to existing notes safely, use docket_update_notes with only the new prose and its evidence.'
      },
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
      evidence: {
        type: 'array',
        maxItems: WRITE_LIMITS.evidencePerCall,
        items: EVIDENCE_SCHEMA,
        description: 'Evidence for the resource itself: at least one entry for a new resource.'
      },
      dryRun: { type: 'boolean', description: 'Check the write and return what it would say, without writing.' }
    },
    required: ['id', 'type', 'title', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Remember a resource, with evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

export const UPDATE_NOTES_DEFINITION = {
  name: 'docket_update_notes',
  title: 'Append narrative notes to a resource',
  description:
    'Add narrative Markdown notes to an existing resource in this workspace, with evidence. The server reads the latest ' +
    'notes and appends yours with a dated separator, preserving existing notes and concurrent additions. Send only the ' +
    'new prose, including your reasoning and source citations. Repeating a call appends again; this tool is not idempotent. ' +
    'Use docket_remember to create a resource or deliberately replace its body. Repo and CLI notes stay at their source; ' +
    "additions go in the resource's cloud document and are shown together with those notes.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The existing resource id.' },
      additional_notes: {
        type: 'string',
        minLength: 1,
        maxLength: 60000,
        description: 'Only the new narrative Markdown notes to append. Explain observations, relationships and reasoning in substantial prose, citing supporting evidence.'
      },
      evidence: {
        type: 'array',
        minItems: 1,
        maxItems: WRITE_LIMITS.evidencePerCall,
        items: EVIDENCE_SCHEMA,
        description: 'Evidence supporting the new notes; at least one entry.'
      },
      dryRun: { type: 'boolean', description: 'Validate the append without writing.' }
    },
    required: ['id', 'additional_notes', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Append narrative notes to a resource', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
} satisfies ToolDefinition

export const ADD_EVIDENCE_DEFINITION = {
  name: 'docket_add_evidence',
  title: 'Add evidence to a resource or link',
  description:
    'Record more evidence for a resource already in this workspace, or for one of its links: where else it was seen. ' +
    'Evidence is append-only and raises confidence when it comes from an independent source. To add a new link, use ' +
    'docket_remember with the link and its evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id, as docket_search returns it.' },
      link: {
        type: 'object',
        description: 'Add the evidence to this link of the resource instead of the resource itself.',
        properties: {
          rel: { type: 'string', minLength: 1, maxLength: 100 },
          target: { type: 'string', minLength: 1, maxLength: 200 }
        },
        required: ['rel', 'target'],
        additionalProperties: false
      },
      evidence: { type: 'array', maxItems: WRITE_LIMITS.evidencePerCall, items: EVIDENCE_SCHEMA, description: 'At least one entry.' }
    },
    required: ['id', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Add evidence to a resource or link', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

export const RETIRE_DEFINITION = {
  name: 'docket_retire',
  title: 'Retire a resource',
  description:
    'Retire a resource that was written on this server (through MCP or the web app) and is wrong or gone, with the reason. ' +
    'It leaves search and the graph at the next index update; its history is kept. A resource that comes from a ' +
    'repository cannot be retired here: change it in the repo and push.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource id.' },
      reason: { type: 'string', minLength: 1, maxLength: WRITE_LIMITS.reasonLength, description: 'Why it is retired, for the activity log.' }
    },
    required: ['id', 'reason'],
    additionalProperties: false
  },
  annotations: { title: 'Retire a resource', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

export const SUPERSEDE_DEFINITION = {
  name: 'docket_supersede',
  title: 'Mark a resource superseded by a newer one',
  description:
    'Mark a resource out of date because a newer resource replaces it - a renamed bot, a moved owner, a decision ' +
    'reversed - with the reason and evidence of the change. Nothing is deleted: the older resource stays on file with ' +
    'until when it held and a link to its replacement, and docket_search answers with the replacement and a note of ' +
    'the change instead of presenting the older one as current. Write the newer resource first with docket_remember. ' +
    'Use docket_retire instead for a resource that was simply wrong and has no replacement.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource that went out of date.' },
      by: { type: 'string', minLength: 1, maxLength: 200, description: 'The resource that replaces it: one already in this workspace, and current itself.' },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: WRITE_LIMITS.reasonLength,
        description: 'What changed, in a sentence a reader will see beside the older resource, e.g. "The Muse bot was renamed from Sophia to Captin."'
      },
      validUntil: { type: 'string', maxLength: 40, description: 'When the older resource stopped holding: YYYY-MM-DD or an ISO timestamp. Defaults to now.' },
      evidence: {
        type: 'array',
        minItems: 1,
        maxItems: WRITE_LIMITS.evidencePerCall,
        items: EVIDENCE_SCHEMA,
        description: 'Where the change was seen: at least one entry.'
      }
    },
    required: ['id', 'by', 'reason', 'evidence'],
    additionalProperties: false
  },
  annotations: { title: 'Mark a resource superseded by a newer one', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
} satisfies ToolDefinition

const PATCH_DESCRIPTION = 'YAML merge patch onto the published ontology, for example "resourceTypes:\\n  queue:\\n    description: A message queue.\\n".'

export const PROPOSE_ONTOLOGY_DEFINITION = {
  name: 'docket_propose_ontology_change',
  title: 'Propose an ontology change',
  description:
    "Propose a change to this workspace's ontology as a draft: new resource types, relationships, attributes or " +
    'evidence sources. Give either patch, a YAML merge patch onto the published ontology (a mapping merges key by key; ' +
    'null removes a key), or yaml, a whole ontology. It returns the change check: what the draft would do to every ' +
    'document. It never publishes; an admin reviews and publishes drafts in the web app (or, where the workspace allows ' +
    'your role, docket_publish_ontology_change publishes directly).',
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: PATCH_DESCRIPTION },
      yaml: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'A whole ontology (entities.yaml), instead of a patch.' },
      message: { type: 'string', maxLength: 500, description: 'Why: shown to the admin who reviews the draft.' }
    },
    additionalProperties: false
  },
  annotations: { title: 'Propose an ontology change', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
} satisfies ToolDefinition

export const PUBLISH_ONTOLOGY_DEFINITION = {
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
      patch: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: PATCH_DESCRIPTION },
      yaml: { type: 'string', maxLength: MAX_ONTOLOGY_BYTES, description: 'A whole ontology (entities.yaml), instead of a patch.' },
      message: { type: 'string', maxLength: 500, description: 'Why: kept with the version in the ontology history.' },
      expectedHead: {
        type: 'integer',
        minimum: 0,
        description: 'The version you read and are changing (docket_ontology names it): refused if another was published since.'
      },
      migration: {
        type: 'array',
        maxItems: 50,
        description: 'Steps that carry existing documents across a breaking change, rewriting cloud documents as new revisions.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: [...MIGRATION_OPS],
              description: 'renameType or mapType (from a type to another the new ontology has), renameRelationship, or dropAttribute (from an attribute of type).'
            },
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
        description:
          'By resource id, for each resource the change still leaves unknown after the migration: accept-data-loss, or update-in-repo for a repo or CLI document a migration step covers.',
        additionalProperties: { type: 'string', enum: [...DISPOSITIONS] }
      }
    },
    additionalProperties: false
  },
  annotations: { title: 'Publish an ontology change', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
} satisfies ToolDefinition

/** Every tool of the surface, in the order `tools/list` gives them: reads first, then writes. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  SEARCH_DEFINITION,
  GET_DEFINITION,
  ASK_DEFINITION,
  ONTOLOGY_DEFINITION,
  REMEMBER_DEFINITION,
  UPDATE_NOTES_DEFINITION,
  ADD_EVIDENCE_DEFINITION,
  RETIRE_DEFINITION,
  SUPERSEDE_DEFINITION,
  PROPOSE_ONTOLOGY_DEFINITION,
  PUBLISH_ONTOLOGY_DEFINITION
]

/** The surface's tool names, in order. */
export const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((definition) => definition.name)

/** The names of the write tools: every tool not annotated read-only. */
export const WRITE_TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.filter((definition) => definition.annotations?.readOnlyHint !== true).map(
  (definition) => definition.name
)

/**
 * What a client relies on in a tool: everything but its description, which a
 * host words for where it runs. Two hosts offer the same surface when their
 * tools' `surfaceOf` are equal, in order.
 */
export function surfaceOf(definition: ToolDefinition): Omit<ToolDefinition, 'description'> {
  const { description: _description, ...surface } = definition
  return surface
}

/** A definition of the surface with a host's own description. */
export function describedAs<T extends ToolDefinition>(definition: T, description: string): T {
  return { ...definition, description }
}
