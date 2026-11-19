import { filesystemSource, localTools, type Tool } from '@chrisjowen/docket'
import { ProjectIndexer, listProjectDocuments, loadConfig, pushToProject, readViews, type ResolvedConfig } from '@chrisjowen/docket/host'

import type { Role } from '../auth/roles.js'
import type { Scope } from '../auth/scopes.js'
import type { ServerTool, ToolContext } from '../mcp/context.js'
import { serverTools } from '../mcp/tools/index.js'
import type { StoreRunner } from '../ports.js'
import type { ServeBackend, ServedWorkspace } from './backend.js'
import type { ServeConfig } from './config.js'

/*
 * `docket serve` over projects' own files, needing no database: each
 * workspace is a project's docket, written through the same local tools
 * `docket open`'s MCP server offers, under the project's write lock, so
 * several people and agents - and `docket open` beside them - take turns
 * rather than write over each other, and a stale `expectedHead` is refused as
 * before. The project's own adapters (jsonl unless it says otherwise) are
 * kept in sync after every write.
 */

/** The scope each tool needs, as the server's own tools name it, so the same token reaches the same tools over files. */
const SCOPES_BY_TOOL: ReadonlyMap<string, Scope> = (() => {
  const unused = () => {
    throw new Error('not called')
  }
  const context: ToolContext = {
    workspaceId: '',
    viewer: '',
    ontologyHistory: '',
    store: { run: unused },
    query: { search: unused, ask: unused },
    beforeModelCall: unused,
    actor: '',
    userId: '',
    writer: unused,
    role: unused,
    audited: unused
  }
  return new Map(serverTools(context).map((entry) => [entry.tool.definition.name, entry.scope]))
})()

/** A files-backed workspace has no SQL store; nothing in its tools asks for one. */
const NO_STORE: StoreRunner = {
  run: () => Promise.reject(new Error('This workspace keeps its documents in files: it has no SQL store.'))
}

const WRITE_TOOLS = new Set([...SCOPES_BY_TOOL].filter(([, scope]) => scope !== 'docket:read' && scope !== 'ontology:read').map(([name]) => name))

interface FileWorkspace extends ServedWorkspace {
  path: string
  /** The project's config as the server started with it, which the MCP server reads documents through. */
  resolved: ResolvedConfig
  indexer: ProjectIndexer
}

export async function filesBackend(config: ServeConfig, options: { syncIntervalMs?: number } = {}): Promise<ServeBackend> {
  const workspaces: FileWorkspace[] = []
  for (const entry of config.workspaces) {
    const resolved = await loadConfig(entry.path as string)
    workspaces.push({
      slug: entry.slug,
      id: entry.slug,
      path: resolved.projectRoot,
      resolved,
      indexer: new ProjectIndexer({ cwd: resolved.projectRoot, intervalMs: options.syncIntervalMs })
    })
  }
  // Bring every index up to the files before the first question.
  for (const workspace of workspaces) workspace.indexer.kick()
  const of = (workspace: ServedWorkspace): FileWorkspace => {
    const found = workspaces.find((each) => each.slug === workspace.slug)
    if (!found) throw new Error(`No workspace ${workspace.slug}.`)
    return found
  }

  return {
    kind: 'files',
    workspaces,
    mcp(served) {
      const workspace = of(served)
      return {
        store: () => NO_STORE,
        query: () => ({
          search: () => Promise.reject(new Error('not used over files')),
          ask: () => Promise.reject(new Error('not used over files'))
        }),
        source: () => filesystemSource(workspace.resolved),
        tools(context: ToolContext): ServerTool[] {
          const registry = localTools({
            cwd: workspace.path,
            writer: { actor: context.actor, label: `${context.actor.replace(/^token:/, '')} via docket serve`, principal: context.actsFor },
            people: config.people ?? undefined,
            ask: config.ai ? { summarize: config.ai } : false,
            publisher: { role: () => context.role(), allowed: async (): Promise<readonly Role[]> => config.ontology.mcpWriters }
          })
          return Object.values(registry).map((tool): ServerTool => {
            const name = tool.definition.name
            const scope = SCOPES_BY_TOOL.get(name)
            if (!scope) throw new Error(`docket's local tool ${name} has no scope on the server`)
            if (!WRITE_TOOLS.has(name)) return { scope, tool }
            const written: Tool = {
              definition: tool.definition,
              call: async (args, toolContext) => {
                try {
                  return await tool.call(args, toolContext)
                } finally {
                  workspace.indexer.kick()
                }
              }
            }
            return { scope, tool: written }
          })
        }
      }
    },
    written(served) {
      of(served).indexer.kick()
    },
    async documents(served, query) {
      const all = await listProjectDocuments(await loadConfig(of(served).path), query)
      const from = query.after === undefined ? all : all.filter((document) => document.path > (query.after as string))
      const page = from.slice(0, query.limit)
      return { documents: page, ...(from.length > page.length ? { next: page.at(-1)?.path as string } : {}) }
    },
    async push(served, writer, request, dryRun) {
      const workspace = of(served)
      const result = await pushToProject(await loadConfig(workspace.path), { label: writer.label }, request, { dryRun })
      if (result.ok && !dryRun) workspace.indexer.kick()
      return result
    },
    readViews(served) {
      const workspace = of(served)
      return readViews({
        cwd: workspace.path,
        sync: workspace.indexer.runner,
        refusal: 'docket serve keeps this index in sync after every write.',
        summarize: config.ai ?? false
      })
    },
    async indexed(served) {
      await of(served).indexer.idle()
    },
    async rebuild(served) {
      await of(served).indexer.rebuild()
    },
    async ready() {
      const missing: string[] = []
      for (const workspace of workspaces) {
        try {
          await loadConfig(workspace.path)
        } catch {
          missing.push(workspace.slug)
        }
      }
      return missing.length ? { ok: false, detail: `cannot read the docket of ${missing.join(', ')}` } : { ok: true, detail: `${workspaces.length} workspace(s) over files` }
    },
    async close() {
      await Promise.all(workspaces.map((workspace) => workspace.indexer.close()))
    }
  }
}

