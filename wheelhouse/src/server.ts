import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  Available,
  Project,
  ProviderContext,
  ServiceContext,
  ServiceResolution,
  WheelhousePlugin
} from './contract.js'

/**
 * docket's Wheelhouse plugin: a project's docket casebook - everything
 * `docket open`'s page has, Browse, Ask, Adapters, the inspector, chat and
 * sync - as a project tab in Wheelhouse. The tab is the `<docket-casebook>`
 * element (`wheelhouse/ui/index.js`, built from docket-ui), which draws the
 * casebook from the project's docket viewer: `docket open`, started as the
 * plugin's `viewer` service on 127.0.0.1 with `--allow-origin` for
 * Wheelhouse's page, so the page may use its API. The server entry only
 * works out where the docket is and how to start its viewer; it never runs
 * anything that writes, and Wheelhouse starts the viewer only on the
 * captain's click. The viewer is the docket this plugin ships
 * (`wheelhouse/docket/`, built from the same commit by build.mjs), run with
 * Wheelhouse's own node, so installing or updating the plugin brings the
 * docket it was built with. The viewer is also docket's MCP server, `docket`, at
 * `/mcp`: its `docket_search` tool returns the resources a search finds with
 * an MCP app that draws them and their links on the casebook's board
 * (docs/mcp.md), for Wheelhouse to show. Its id, version, contract, enable
 * rule, slot, service and MCP server are in `.wheelhouse-plugin/plugin.json`.
 *
 * Settings (Wheelhouse's plugins.json, `plugins.docket.settings`), all optional:
 *   bin      a docket CLI to run instead of the one the plugin ships: an
 *            absolute path, or a command name (`docket`) found on PATH.
 *   roots    { "<project id>": "<absolute dir>" }: show that docket for the
 *            project instead of the clone's own.
 *   ports    { "<project id>": <port> }: where the project's viewer serves;
 *            otherwise one Wheelhouse picks and keeps for it.
 *   origins  [ "<origin>", ... ]: the Wheelhouse pages the viewer lets use it,
 *            http(s) on 127.0.0.1, localhost or [::1]; otherwise Wheelhouse's
 *            own address, http://127.0.0.1:4310 and http://localhost:4310.
 */

const DOCKET_FILE = '.docket.yaml'

/** Where `wheelhouse open` serves its pages unless told another port. */
export const DEFAULT_ORIGINS = ['http://127.0.0.1:4310', 'http://localhost:4310']

/** docket's MCP server, on the viewer: `docket open` serves it at `/mcp` (docs/mcp.md). */
export const MCP_SERVER = { id: 'docket', title: 'Docket', service: 'viewer', path: '/mcp' } as const

/** The element's schema: `wheelhouse-docket-casebook.v1`, which docket-ui's src/embed/host.ts reads. */
export const CASEBOOK_SCHEMA = 'wheelhouse-docket-casebook.v1'

/** The docket CLI the viewer runs, as the casebook shows it. */
export interface DocketCli {
  /** `plugin`: the docket this plugin ships; `settings`: the `bin` its settings name. */
  source: 'plugin' | 'settings'
  /** Its version, or null when it does not say. */
  version: string | null
  /** The command that runs it. */
  command: string
}

export interface CasebookData {
  schema: typeof CASEBOOK_SCHEMA
  state: 'docket' | 'none'
  root: string | null
  configuredRoot: boolean
  origins: string[]
  problem: string | null
  /** The docket the viewer runs; null when the project keeps no docket. */
  docket: DocketCli | null
}

export interface DocketSettings {
  bin: string | null
  roots: Record<string, string>
  ports: Record<string, number>
  origins: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * An origin docket open accepts for `--allow-origin`, normalised, or null: an
 * http(s) page on this machine and nothing more than its origin.
 */
export function pageOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!LOOPBACK.has(url.hostname)) return null
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) return null
  return url.origin
}

/** The plugin's settings, keeping only what is well formed. */
export function readSettings(raw: Record<string, unknown>): DocketSettings {
  const abs = (value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value)
  const command = (value: unknown): value is string => abs(value) || (typeof value === 'string' && /^[\w-][\w.-]*$/.test(value))
  const roots: Record<string, string> = {}
  if (isRecord(raw.roots)) for (const [id, dir] of Object.entries(raw.roots)) if (abs(dir)) roots[id] = dir
  const ports: Record<string, number> = {}
  if (isRecord(raw.ports)) {
    for (const [id, port] of Object.entries(raw.ports)) {
      if (typeof port === 'number' && Number.isInteger(port) && port > 1023 && port < 65536) ports[id] = port
    }
  }
  const given = Array.isArray(raw.origins) ? raw.origins.map(pageOrigin).filter((origin): origin is string => origin !== null) : []
  return {
    bin: command(raw.bin) ? raw.bin : null,
    roots,
    ports,
    origins: given.length > 0 ? [...new Set(given)] : DEFAULT_ORIGINS
  }
}

/** The port a project's viewer asks for first: one worked out from the project id (4381-4780), as Wheelhouse's own Docket plugin did. */
export function preferredPort(projectId: string): number {
  let h = 0x811c9dc5
  for (const c of projectId) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return 4381 + (h % 400)
}

/** A path or argument as one shell word, for a command the captain copies. */
const shellWord = (s: string): string => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/** `docket open`'s arguments for the viewer of a docket: loopback, this port, these pages allowed, no browser. */
export const viewerArgs = (port: number, origins: string[]): string[] => [
  'open',
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
  '--no-open',
  ...origins.flatMap((origin) => ['--allow-origin', origin])
]

/** The command that starts a docket's viewer by hand, with `docket` the words that run the docket CLI. */
export const openCommand = (docket: string[], root: string, port: number, origins: string[]): string =>
  `cd ${shellWord(root)} && ${[...docket, ...viewerArgs(port, origins).filter((arg) => arg !== '--no-open')].map(shellWord).join(' ')}`

/** Whether a docket CLI's `docket open --help` offers `--allow-origin`, which Wheelhouse needs. */
export const allowsOrigins = (help: string): boolean => /(^|\s)--allow-origin\b/m.test(help)

/** The version `docket --version` prints, or null for a docket too old to say. */
export const versionOf = (stdout: string): string | null => {
  const version = stdout.trim()
  return /^\d+\.\d+\.\d+[\w.+-]*$/.test(version) ? version : null
}

/** The docket this plugin ships: built from the same commit as the plugin into `wheelhouse/docket/` (build.mjs). */
export const SHIPPED_DOCKET = fileURLToPath(new URL('../docket/', import.meta.url))

/** The docket CLI the viewer runs: the words that run it, what the casebook says about it, and anything in the way. */
interface Cli {
  argv: string[]
  info: DocketCli
  problem: string | null
}

const shippedVersion = (dir: string): string | null => {
  try {
    const { version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

/**
 * The docket this plugin ships, run with the node running Wheelhouse (which,
 * like docket, needs Node 22). It is the plugin's own commit, so it can serve
 * Wheelhouse's page without being asked, and starts nothing to find out.
 */
export function shippedCli(dir: string = SHIPPED_DOCKET, node: string = process.execPath): Cli {
  const cli = path.join(dir, 'dist', 'cli.js')
  const argv = [node, cli]
  const version = shippedVersion(dir)
  const info: DocketCli = { source: 'plugin', version, command: argv.map(shellWord).join(' ') }
  if (version === null || !existsSync(cli)) {
    return {
      argv,
      info,
      problem: `The docket this plugin ships is missing from ${dir}. Update or reinstall the docket plugin, or set "bin" in its settings to a docket CLI.`
    }
  }
  return { argv, info, problem: null }
}

/** What a configured docket CLI says about itself, asked at most once a minute per CLI. */
const asked = new Map<string, { at: number; value: Promise<Cli> }>()
const ASK_TTL_MS = 60_000

/** Forget what each docket CLI offers (tests). */
export function clearCliCache(): void {
  asked.clear()
}

/**
 * The docket CLI the plugin's settings name (`bin`), asked its version and
 * whether its docket open can serve Wheelhouse's page, in plain words when it
 * cannot.
 */
function configuredCli(ctx: ProviderContext, bin: string, project: string): Promise<Cli> {
  const hit = asked.get(bin)
  if (hit && Date.now() - hit.at < ASK_TTL_MS) return hit.value
  const run = (args: string[]) => ctx.exec({ argv: [bin, ...args], cwd: 'project', project, timeoutMs: 5_000, maxBytes: 64 * 1024 })
  const value = Promise.all([run(['open', '--help']), run(['--version'])]).then(([help, said]): Cli => {
    const version = said.ok ? versionOf(said.stdout) : null
    const cli = (problem: string | null): Cli => ({ argv: [bin], info: { source: 'settings', version, command: shellWord(bin) }, problem })
    const named = `The docket CLI the docket plugin’s settings name (${bin}${version ? `, docket ${version}` : ''})`
    const shipped = shippedVersion(SHIPPED_DOCKET)
    const instead = `remove "bin" to run the docket this plugin ships${shipped ? ` (${shipped})` : ''}`
    if (help.ok) {
      return cli(
        allowsOrigins(help.stdout)
          ? null
          : `${named} is too old to be shown in Wheelhouse: its docket open cannot allow Wheelhouse’s page (--allow-origin). Update it, or ${instead}.`
      )
    }
    if (/ENOENT/.test(help.reason)) return cli(`Wheelhouse could not find the docket CLI (${bin}) the docket plugin’s settings name. Fix "bin", or ${instead}.`)
    if (/EACCES/.test(help.reason)) return cli(`${named} is not executable. Fix "bin", or ${instead}.`)
    const first = help.stderr.trim().split('\n')[0]
    return cli(`${named} could not be asked what it offers (${help.reason}${first ? `: ${first.slice(0, 200)}` : ''}).`)
  })
  asked.set(bin, { at: Date.now(), value })
  // A failure is asked again next time: it may have been fixed meanwhile.
  void value.then((cli) => {
    if (cli.problem && asked.get(bin)?.value === value) asked.delete(bin)
  })
  return value
}

/** The docket CLI a project's viewer runs: the one the settings name, else the one this plugin ships. */
const docketCli = (ctx: ProviderContext, settings: DocketSettings, project: string): Promise<Cli> =>
  settings.bin === null ? Promise.resolve(shippedCli()) : configuredCli(ctx, settings.bin, project)

const realRoot = (root: string): string => {
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

/** The docket a project shows: its `roots` setting, else its clone; null when Firstmate recorded no clone. */
const rootOf = (project: Project, settings: DocketSettings): { root: string; configured: boolean } | null => {
  const configured = settings.roots[project.id]
  if (configured) return { root: configured, configured: true }
  return project.path && path.isAbsolute(project.path) ? { root: project.path, configured: false } : null
}

/** The casebook tab's value: where the docket is, the pages its viewer allows, and anything in the way. */
async function casebook(ctx: ProviderContext): Promise<Available<CasebookData>> {
  const project = ctx.project
  if (!project) return { available: false, reason: 'The casebook is about one project.' }
  const settings = readSettings(ctx.settings)
  const where = rootOf(project, settings)
  if (!where) return { available: false, reason: 'Firstmate has not recorded a clone for this project.' }
  const base = { schema: CASEBOOK_SCHEMA, root: where.root, configuredRoot: where.configured, origins: settings.origins } as const
  const observedAt = new Date().toISOString()
  const source = where.configured ? `the docket at ${where.root}, set in Wheelhouse’s plugins file` : 'the project’s docket'
  if (!where.configured) {
    const marker = await ctx.readFile(DOCKET_FILE, { root: 'project', maxBytes: 1, project: project.id })
    if (marker === null) return { available: true, value: { ...base, state: 'none', problem: null, docket: null }, source: 'the project clone', observedAt }
  }
  const cli = await docketCli(ctx, settings, project.id)
  return {
    available: true,
    value: { ...base, state: 'docket', problem: cli.problem, docket: cli.info },
    source,
    observedAt
  }
}

/**
 * The project's docket viewer (`docket open`) as a companion service, on a
 * port of its own - its `ports` setting, else the one Wheelhouse keeps for
 * it - on 127.0.0.1, allowing Wheelhouse's page. Wheelhouse checks that the
 * viewer answering there serves this project's docket. A docket too old to
 * allow Wheelhouse's page, or missing, is not started: the casebook could not
 * use it.
 */
async function viewer(ctx: ServiceContext): Promise<ServiceResolution> {
  const project = ctx.project
  if (!project) return { available: false, reason: 'docket’s viewer is about one project.' }
  const settings = readSettings(ctx.settings)
  const where = rootOf(project, settings)
  if (!where) return { available: false, reason: 'Firstmate has not recorded a clone for this project.' }
  const port = settings.ports[project.id] ?? (await ctx.servicePort(preferredPort(project.id), Object.values(settings.ports)))
  const url = `http://127.0.0.1:${port}`
  const cli = await docketCli(ctx, settings, project.id)
  const hint = openCommand(cli.argv, where.root, port, settings.origins)
  if (cli.problem) return { available: false, reason: cli.problem, hint }
  return {
    available: true,
    hint,
    spec: {
      url,
      health: `${url}/api/health`,
      identity: { url: `${url}/api/health`, path: ['root'], value: realRoot(where.root) },
      argv: [...cli.argv, ...viewerArgs(port, settings.origins)],
      cwd: where.root,
      binds: 'loopback'
    }
  }
}

const plugin: WheelhousePlugin = {
  services: [{ id: 'viewer', title: 'docket’s viewer', scope: 'project', resolve: viewer }],
  providers: [{ id: 'casebook', scope: 'project', ttlMs: 30_000, timeoutMs: 8_000, fetch: casebook }],
  contributions: [
    {
      slot: 'project.tab',
      id: 'casebook',
      title: 'Docket',
      provider: 'casebook',
      render: { element: 'docket-casebook' }
    }
  ],
  mcpServers: [{ ...MCP_SERVER }]
}

export default plugin
