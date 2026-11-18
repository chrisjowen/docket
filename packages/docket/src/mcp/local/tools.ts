import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'

import { filesystemSource, type CanonicalSource } from '../../canonical/source.js'
import { validate } from '../../commands/validate.js'
import type { ResolvedConfig, SummarizeConfig } from '../../config/config.js'
import { loadConfig } from '../../config/loader.js'
import { askProject } from '../../query/ask.js'
import { currentRecord } from '../../workspace/supersession.js'
import { splitDocument } from '../../workspace/write/document.js'
import type { Writer } from '../../workspace/write/inputs.js'
import { searchGraph } from '../search.js'
import type { Tool, ToolRegistry } from '../server.js'
import {
  addEvidenceArguments,
  askArguments,
  getArguments,
  ontologyArguments,
  proposalArguments,
  publishArguments,
  rememberArguments,
  retireArguments,
  searchArguments,
  supersedeArguments,
  updateNotesArguments
} from '../surface/arguments.js'
import {
  ontologyAnswer,
  proposalAnswer,
  proposalRefusal,
  publishAnswer,
  publishRefusal,
  resourceAnswer,
  retireAnswer,
  searchAnswer,
  supersedeAnswer
} from '../surface/answers.js'
import {
  ADD_EVIDENCE_DEFINITION,
  ASK_DEFINITION,
  GET_DEFINITION,
  ONTOLOGY_DEFINITION,
  PROPOSE_ONTOLOGY_DEFINITION,
  PUBLISH_ONTOLOGY_DEFINITION,
  REMEMBER_DEFINITION,
  RETIRE_DEFINITION,
  SEARCH_BASE_DESCRIPTION,
  SEARCH_DEFINITION,
  SUPERSEDE_DEFINITION,
  UPDATE_NOTES_DEFINITION,
  describedAs
} from '../surface/definitions.js'
import { ASK_SCHEMA, answerText, failed, type AskResponse } from '../surface/results.js'
import { OntologyWriteDisabled } from '../../workspace/ontology/errors.js'
import { writeAnswer } from '../surface/write-args.js'
import {
  declaring,
  describeResource,
  headOf,
  historyPath,
  liveSupersessions,
  readWorkspace,
  storeOf,
  writeLock,
  type LocalWorkspace
} from './files.js'
import { proposeOntologyChange, publishOntologyChange } from './ontology.js'
import { changesOf, scopedSearch, withSupersessions } from './search.js'
import { addEvidence, appendNotes, retireResource, supersedeResource, writeResource } from './write.js'

/*
 * Docket's MCP surface over a project's own files: the tools Docket Cloud and
 * a self-hosted server offer, with the same names, input schemas, argument
 * checks and answers, read from and written to the docket in the project. One
 * person's machine, so no tenancy and no sign-in: every tool is offered,
 * publishing the ontology too.
 */

export interface LocalToolsOptions {
  /** The docket's directory: `.docket.yaml` is resolved from it on each call. */
  cwd: string
  /** Who writes, as evidence names them. Omitted: this machine's user, through docket's MCP server. */
  writer?: { actor: string; label: string } | undefined
  /** The clock, for tests. */
  now?: (() => Date) | undefined
  /**
   * How `docket_ask` writes its summary: with the model given, or not at all
   * (`false`: the tool answers that asking is off, as a server without a
   * model does). Omitted: as `.docket.yaml`'s `query` and `summarize` say.
   */
  ask?: { summarize: SummarizeConfig } | false | undefined
  /**
   * Who may publish the ontology (`docket_publish_ontology_change`): the
   * caller's role and the roles allowed, re-checked on each call. Omitted:
   * anyone, as on one person's machine.
   */
  publisher?: { role(): Promise<string | null>; allowed(): Promise<readonly string[]> } | undefined
}

/** The person at this machine, as evidence names them. */
const localWriter = (): { actor: string; label: string } => {
  let user = 'local'
  try {
    user = userInfo().username || user
  } catch {
    // No user database entry: the generic name will do.
  }
  return { actor: `local:${user}`, label: `${user} via docket MCP` }
}

/** "this workspace" as the descriptions say it, for one project's docket. */
const forProject = (text: string): string => text.replaceAll("this workspace's", "this project's").replaceAll('this workspace', 'this project').replaceAll('the workspace', 'the project')

const DESCRIPTIONS: Record<string, string> = {
  docket_search:
    `${SEARCH_BASE_DESCRIPTION} Looks in the facts the projections hold and the graph they return (include picks one); ` +
    'this docket keeps no activity timeline. Each result shows its confidence (how well its evidence supports it), and ' +
    'a record superseded by a newer one is answered with its replacement and a note of the change.',
  docket_get: forProject(GET_DEFINITION.description).replace('and their revision history, ', ''),
  docket_ask:
    "Ask a question about this project's knowledge in words. docket puts it to every projection (the graph and " +
    'semantic memory), checks each answer against the canonical documents, and has the model docket is set up to ' +
    'summarise with (summarize in .docket.yaml) write a short answer that cites the resources and evidence it relies on, ' +
    'as `docket ask` does.',
  docket_ontology: forProject(ONTOLOGY_DEFINITION.description),
  docket_remember: `${forProject(REMEMBER_DEFINITION.description)} The resource's document in the project's docket is changed in place, or a new one made beside the project's other documents of its type.`,
  docket_update_notes:
    "Add narrative Markdown notes to an existing resource in this project, with evidence. docket reads the resource's " +
    'document and appends yours to its notes with a dated separator. Send only the new prose, including your reasoning ' +
    'and source citations. Repeating a call appends again; this tool is not idempotent. Use docket_remember to create a ' +
    'resource or deliberately replace its body.',
  docket_add_evidence: forProject(ADD_EVIDENCE_DEFINITION.description),
  docket_retire:
    'Retire a resource of this project that is wrong or gone, with the reason: the documents that declare it are removed ' +
    "from the project's docket, so it leaves search and the graph at the next sync. Its history is kept in git.",
  docket_supersede: `${forProject(SUPERSEDE_DEFINITION.description)} The supersession is recorded in .docket/supersessions.yaml; the documents are untouched.`,
  docket_propose_ontology_change:
    "Propose a change to this project's ontology as a draft: new resource types, relationships, attributes or evidence " +
    'sources. Give either patch, a YAML merge patch onto the ontology (a mapping merges key by key; null removes a key), ' +
    'or yaml, a whole ontology. It returns the change check: what the draft would do to every document. The draft is ' +
    'saved under .docket/ontology-drafts/ for review; it never publishes - docket_publish_ontology_change does.',
  docket_publish_ontology_change:
    "Change this project's ontology directly: writes the next version of its ontology file - every document is " +
    're-checked, a migration rewrites the documents it names, and the version is recorded in .docket/ontology-history.yaml ' +
    "(the earlier text stays in git). Give either patch, a YAML merge patch onto the ontology (a mapping merges key by key; " +
    'null removes a key), or yaml, a whole ontology. A change that breaks resources (a type or relationship they use goes ' +
    'away) needs a migration that resolves them, or a disposition for each; one that gives resources new diagnostics needs ' +
    'acceptNarrowing. Try docket_propose_ontology_change first to see what a change does.'
}

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The documents that declare `id`, as a canonical source of their own, so validation merges just them. */
function resourceSource(workspace: LocalWorkspace, id: string): CanonicalSource {
  const { ontology } = workspace
  return {
    resolved: workspace.resolved,
    async ontology() {
      if (!ontology) throw new Error('This docket has no ontology file to read.')
      return { text: ontology.text, revision: ontology.revision }
    },
    async *documents() {
      for (const entry of declaring(workspace, id)) {
        if (entry.raw !== undefined && entry.hash !== undefined) yield { path: entry.path, raw: entry.raw, hash: entry.hash }
      }
    }
  }
}

/** A document's whole frontmatter `summary`, when it has one. */
function summaryOf(raw: string | undefined): string | undefined {
  const data: unknown = raw === undefined ? undefined : splitDocument(raw)?.frontmatter.toJS()
  const summary = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).summary : undefined
  return typeof summary === 'string' && summary.trim() !== '' ? summary.trim() : undefined
}

/**
 * Every tool of Docket's MCP surface over the project's own files, by name,
 * in the surface's order: search, get, ask and the ontology to read; remember,
 * update notes, add evidence, retire, supersede, and propose and publish an
 * ontology change to write.
 */
export function localTools(options: LocalToolsOptions): ToolRegistry {
  const { cwd } = options
  const now = options.now ?? (() => new Date())
  const identity = options.writer ?? localWriter()
  const writerFor = (resolved: ResolvedConfig): Writer => ({
    workspaceId: resolved.projectRoot,
    actor: identity.actor,
    label: identity.label,
    channel: 'mcp',
    requestId: `mcp:${randomUUID()}`
  })
  const describe = <T extends Tool['definition']>(definition: T): T => describedAs(definition, DESCRIPTIONS[definition.name] ?? definition.description)
  /** Runs a write against the project's files as they are now, after any write already running here or in another process. */
  const writing = async <T>(fn: (workspace: LocalWorkspace, writer: Writer) => Promise<T>): Promise<T> => {
    const resolved = await loadConfig(cwd)
    return writeLock(resolved, async () => fn(await readWorkspace(resolved), writerFor(resolved)))
  }

  const tools: Tool[] = [
    {
      definition: describe(SEARCH_DEFINITION),
      async call(raw, context) {
        const args = searchArguments(raw)
        try {
          const resolved = await loadConfig(cwd)
          const found = scopedSearch(await searchGraph({ source: filesystemSource(resolved), query: args.query, limit: args.limit, viewer: context.viewer }), args)
          return searchAnswer(await withSupersessions(resolved, found))
        } catch (cause) {
          // A docket that cannot be read is the tool's answer, for the model to read, not a protocol error.
          return failed(`The docket could not be searched: ${errorText(cause)}`)
        }
      }
    },
    {
      definition: describe(GET_DEFINITION),
      async call(raw, context) {
        const { id } = getArguments(raw)
        const resolved = await loadConfig(cwd)
        const workspace = await readWorkspace(resolved)
        const records = declaring(workspace, id)
        if (records.length === 0) return failed(`There is no resource ${id} in this docket. Call docket_search to find ids.`)
        const read = await validate({ source: resourceSource(workspace, id) })
        const live = await liveSupersessions(workspace)
        const own = live.get(id)
        const currentId = own ? currentRecord(live, id) : null
        const current = currentId && currentId !== id && !live.has(currentId) ? describeResource(workspace, currentId) : null
        return resourceAnswer({
          id,
          viewer: context.viewer,
          entity: read.entities.find((candidate) => candidate.id === id) ?? null,
          ...(() => {
            const summary = records.map((record) => summaryOf(record.raw)).find((value) => value !== undefined)
            return summary ? { summary } : {}
          })(),
          documents: records.map((record) => ({ path: record.path, origin: 'local' as const, hash: record.hash ?? '' })),
          history: [],
          historyNote: "Its revisions are in the project's git history.",
          diagnostics: read.diagnostics,
          ...(own
            ? {
                superseded: {
                  own: { supersededBy: own.supersededBy, validUntil: own.validUntil, reason: own.reason, source: own.source, recordedBy: own.recordedBy, evidence: own.evidence },
                  current: current ? { id: current.id, title: current.title } : null
                }
              }
            : {}),
          supersedes: [...live.values()].filter((each) => each.supersededBy === id).map((each) => ({ id: each.resource, validUntil: each.validUntil, reason: each.reason }))
        })
      }
    },
    {
      definition: describe(ASK_DEFINITION),
      async call(raw) {
        const { question, maxResults } = askArguments(raw)
        if (options.ask === false) return failed('docket_ask is off on this server: it has no model to answer with. Use docket_search, which needs none.')
        let response: AskResponse
        try {
          const resolved = await loadConfig(cwd)
          const { answer } = await askProject(cwd, {
            question,
            ...(maxResults !== undefined ? { maxResults } : {}),
            ...(options.ask ? { summarize: options.ask.summarize, synthesis: true } : {})
          })
          const live = await liveSupersessions(storeOf(resolved))
          const found = [...new Set((answer.references ?? []).flatMap((reference) => (reference.entity && live.has(reference.entity) ? [reference.entity] : [])))]
          const changes = found.length ? changesOf(await readWorkspace(resolved), live, found) : []
          response = { answer, ...(changes.length ? { changes } : {}) }
        } catch (cause) {
          return failed(`The docket could not answer: ${errorText(cause)}`)
        }
        return { content: [{ type: 'text', text: answerText(response) }], structuredContent: { schema: ASK_SCHEMA, ...response } }
      }
    },
    {
      definition: describe(ONTOLOGY_DEFINITION),
      async call(raw) {
        ontologyArguments(raw)
        const workspace = await readWorkspace(await loadConfig(cwd))
        const head = await headOf(workspace)
        if (!head) return failed('This docket has no ontology file yet: `docket init` writes one.')
        return ontologyAnswer({ ...head, yaml: head.text }, 'this docket')
      }
    },
    {
      definition: describe(REMEMBER_DEFINITION),
      async call(raw, context) {
        const { input, dryRun } = rememberArguments(raw)
        const result = await writing((workspace, writer) => writeResource(workspace, writer, input, { dryRun, now }))
        return writeAnswer('docket_remember', input.id, context.viewer, result, dryRun)
      }
    },
    {
      definition: describe(UPDATE_NOTES_DEFINITION),
      async call(raw, context) {
        const { input, dryRun } = updateNotesArguments(raw)
        const result = await writing((workspace, writer) => appendNotes(workspace, writer, input, { dryRun, now }))
        return writeAnswer('docket_update_notes', input.id, context.viewer, result, dryRun)
      }
    },
    {
      definition: describe(ADD_EVIDENCE_DEFINITION),
      async call(raw, context) {
        const input = addEvidenceArguments(raw)
        const result = await writing((workspace, writer) => addEvidence(workspace, writer, input, { now }))
        return writeAnswer('docket_add_evidence', input.id, context.viewer, result, false)
      }
    },
    {
      definition: describe(RETIRE_DEFINITION),
      async call(raw) {
        const input = retireArguments(raw)
        return retireAnswer(input.id, await writing((workspace) => retireResource(workspace, input)))
      }
    },
    {
      definition: describe(SUPERSEDE_DEFINITION),
      async call(raw, context) {
        const input = supersedeArguments(raw)
        const result = await writing((workspace, writer) => supersedeResource(workspace, writer, input, { now }))
        return supersedeAnswer(input, context.viewer, result)
      }
    },
    {
      definition: describe(PROPOSE_ONTOLOGY_DEFINITION),
      async call(raw) {
        const proposal = proposalArguments(raw)
        try {
          const { draftId, path, check } = await writing((workspace, writer) => proposeOntologyChange(workspace, writer, proposal))
          return proposalAnswer(draftId, check, `The draft is saved at ${path}; nothing was published. Publish the change with docket_publish_ontology_change.`)
        } catch (caught) {
          const refused = proposalRefusal(caught)
          if (refused === null) throw caught
          return refused
        }
      }
    },
    {
      definition: describe(PUBLISH_ONTOLOGY_DEFINITION),
      async call(raw) {
        const change = publishArguments(raw)
        try {
          if (options.publisher) {
            const role = await options.publisher.role()
            if (role === null || !(await options.publisher.allowed()).includes(role)) throw new OntologyWriteDisabled(role)
          }
          const { published, history } = await writing(async (workspace, writer) => ({
            published: await publishOntologyChange(workspace, writer, change, { now }),
            history: historyPath(workspace)
          }))
          return publishAnswer(published, history, `It is recorded in ${history}; the earlier version is in the project's git history, where it can be restored.`)
        } catch (caught) {
          const refused = publishRefusal(caught)
          if (refused === null) throw caught
          return refused
        }
      }
    }
  ]
  return Object.fromEntries(tools.map((tool) => [tool.definition.name, tool]))
}
