import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isCasebookData } from '../../packages/docket-ui/src/embed/host.js'
import type { ExecRequest, ExecResult, Project, ServiceContext } from './contract.js'
import plugin, {
  allowsOrigins,
  CASEBOOK_SCHEMA,
  clearCliCache,
  DEFAULT_ORIGINS,
  MCP_SERVER,
  openCommand,
  pageOrigin,
  preferredPort,
  PROJECTS_SCHEMA,
  readSettings,
  SHIPPED_DOCKET,
  shippedCli,
  startsDockets,
  versionOf
} from './server.js'

const here = import.meta.dirname
const repo = path.join(here, '..', '..')
const manifest = JSON.parse(await readFile(path.join(repo, '.wheelhouse-plugin', 'plugin.json'), 'utf8')) as {
  name: string
  version: string
  wheelhouse: {
    apiVersion: number
    server: string
    ui: string
    enabledByDefault: boolean
    contributions: { id: string; slot: string; icon?: string }[]
    services: { id: string; scope: string }[]
    mcpServers: { id: string; service: string }[]
  }
}

/** The docket this plugin ships, as the viewer runs it: Wheelhouse's own node and the shipped CLI. */
const SHIPPED = [process.execPath, path.join(SHIPPED_DOCKET, 'dist', 'cli.js')]
const docketVersion = (JSON.parse(await readFile(path.join(repo, 'packages', 'docket', 'package.json'), 'utf8')) as { version: string }).version

const HELP_NOW =
  'Usage: docket open [options]\n  --host <address>\n  --no-open\n  --allow-origin <origin>  another page on this machine\n  --init  start a docket here first\n'
/** docket 0.7.0: it allows Wheelhouse's page, but cannot start a docket. */
const HELP_NO_INIT = 'Usage: docket open [options]\n  --host <address>\n  --no-open\n  --allow-origin <origin>  another page on this machine\n'
const HELP_OLD = 'Usage: docket open [options]\n  --host <address>\n  --no-open\n'

const project = (over: Partial<Project> = {}): Project => ({
  id: 'shop',
  name: 'Shop',
  description: null,
  path: '/work/shop',
  ...over
})

interface Fake {
  ctx: ServiceContext
  calls: ExecRequest[]
}

/**
 * A context like Wheelhouse's, with `exec` answering `docket open --help` and
 * `docket --version`, and the clone holding `files` (each other project's
 * clone, `clones[id]`). A fleet context (`fleet`) has no project of its own.
 */
const fake = (
  o: {
    project?: Project | null
    projects?: Project[]
    fleet?: boolean
    help?: ExecResult
    version?: ExecResult
    files?: string[]
    clones?: Record<string, string[]>
    settings?: Record<string, unknown>
  } = {}
): Fake => {
  const calls: ExecRequest[] = []
  const p = o.project === undefined ? project() : o.project
  return {
    calls,
    ctx: {
      project: o.fleet ? null : p,
      projects: o.projects ?? (p ? [p] : []),
      settings: o.settings ?? {},
      signal: new AbortController().signal,
      exec: async (request) => {
        calls.push(request)
        if (request.argv[1] === '--version') return o.version ?? { ok: true, stdout: '0.6.0\n' }
        return o.help ?? { ok: true, stdout: HELP_NOW }
      },
      readFile: async (rel, { project: id }) => {
        const files = (id !== undefined && o.clones?.[id]) || o.files || ['.docket.yaml']
        return files.includes(rel) ? '' : null
      },
      servicePort: async (preferred) => preferred
    }
  }
}

const provider = plugin.providers.find((p) => p.id === 'casebook')!
const projectsProvider = plugin.providers.find((p) => p.id === 'projects')!
const service = plugin.services[0]!

beforeEach(() => clearCliCache())

describe('the manifest', () => {
  it('lists exactly the contributions and services the server entry has', () => {
    expect(manifest.name).toBe('docket')
    expect(manifest.wheelhouse.contributions.map(({ id, slot }) => ({ id, slot }))).toEqual(plugin.contributions.map(({ id, slot }) => ({ id, slot })))
    expect(manifest.wheelhouse.services).toEqual(plugin.services.map(({ id, scope }) => ({ id, scope })))
    expect(manifest.wheelhouse.mcpServers).toEqual(plugin.mcpServers.map(({ id, service }) => ({ id, service })))
    expect(manifest.wheelhouse.apiVersion).toBe(1)
    // On for every project, so the Docket page sees them all; the tab shows only where there is a docket.
    expect(manifest.wheelhouse.enabledByDefault).toBe(true)
    expect(plugin.contributions.find((c) => c.slot === 'project.tab')?.when).toBe('provider-available')
  })

  it('puts the Docket page in Wheelhouse’s menu with its own line icon', async () => {
    const page = manifest.wheelhouse.contributions.find((c) => c.slot === 'nav.page')
    expect(page).toEqual({ id: 'projects', slot: 'nav.page', icon: 'wheelhouse/icon.svg' })
    expect(plugin.contributions.find((c) => c.slot === 'nav.page')).toMatchObject({ title: 'Docket', render: { element: 'docket-projects' } })
    // Drawn as a stencil in the menu's ink: a 24-pixel line icon.
    const svg = new new Window().DOMParser().parseFromString(await readFile(path.join(repo, page!.icon!), 'utf8'), 'image/svg+xml').documentElement
    expect(svg.localName).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('fill')).toBe('none')
  })

  it('names entries that exist, and the built server entry is this one', async () => {
    expect(existsSync(path.join(repo, manifest.wheelhouse.server))).toBe(true)
    expect(existsSync(path.join(repo, manifest.wheelhouse.ui))).toBe(true)
    const entry = (await import(path.join(repo, manifest.wheelhouse.server))) as { default: typeof plugin; SHIPPED_DOCKET: string }
    const built = entry.default
    // Run from where Wheelhouse installs it, it finds the docket shipped beside it.
    expect(entry.SHIPPED_DOCKET).toBe(SHIPPED_DOCKET)
    expect(built.contributions).toEqual(plugin.contributions)
    expect(built.mcpServers).toEqual(plugin.mcpServers)
    expect(built.services.map(({ id, scope, title }) => ({ id, scope, title }))).toEqual(
      plugin.services.map(({ id, scope, title }) => ({ id, scope, title }))
    )
    expect(built.providers.map(({ id, scope, ttlMs }) => ({ id, scope, ttlMs }))).toEqual(
      plugin.providers.map(({ id, scope, ttlMs }) => ({ id, scope, ttlMs }))
    )
  })

  it('serves docket’s MCP server from its own viewer, at docket open’s /mcp', () => {
    expect(plugin.mcpServers).toEqual([{ id: 'docket', title: 'Docket', service: 'viewer', path: '/mcp' }])
    expect(plugin.services.map((s) => s.id)).toContain(MCP_SERVER.service)
  })

  it('draws the tab with an element under the plugin’s own prefix', () => {
    for (const contribution of plugin.contributions) {
      expect(contribution.render.element.startsWith(`${manifest.name}-`)).toBe(true)
    }
  })

  it('keeps its version with docket’s', () => {
    expect(manifest.version).toBe(docketVersion)
  })
})

describe('the docket the plugin ships', () => {
  it('is in the repository, as Wheelhouse installs it, at docket’s version', async () => {
    expect(SHIPPED_DOCKET).toBe(path.join(here, '..', 'docket') + path.sep)
    for (const file of ['dist/cli.js', 'dist/ui/index.html', 'dist/mcp-app/search.html', 'dist/ontology/default-sdlc.yaml']) {
      expect(existsSync(path.join(SHIPPED_DOCKET, file))).toBe(true)
    }
    expect(shippedCli()).toEqual({
      argv: SHIPPED,
      info: { source: 'plugin', version: docketVersion, command: SHIPPED.join(' ') },
      problem: null,
      initProblem: null
    })
  })

  it('prints its version, and its docket open allows Wheelhouse’s page', async () => {
    const run = (...args: string[]) =>
      new Promise<string>((done, fail) => execFile(SHIPPED[0]!, [SHIPPED[1]!, ...args], (error, stdout) => (error ? fail(error) : done(stdout))))
    expect(versionOf(await run('--version'))).toBe(docketVersion)
    const help = await run('open', '--help')
    expect(allowsOrigins(help)).toBe(true)
    expect(startsDockets(help)).toBe(true)
  })

  it('says so when the plugin’s copy is missing', () => {
    const cli = shippedCli('/nowhere/docket/', '/usr/bin/node')
    expect(cli.argv).toEqual(['/usr/bin/node', '/nowhere/docket/dist/cli.js'])
    expect(cli.info).toEqual({ source: 'plugin', version: null, command: '/usr/bin/node /nowhere/docket/dist/cli.js' })
    expect(cli.problem).toContain('The docket this plugin ships is missing from /nowhere/docket/')
    expect(cli.initProblem).toBe(cli.problem)
  })
})

describe('settings', () => {
  it('allows Wheelhouse’s own address unless told other pages', () => {
    expect(readSettings({}).origins).toEqual(DEFAULT_ORIGINS)
    expect(readSettings({ origins: ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173'] }).origins).toEqual(['http://127.0.0.1:5173'])
  })

  it('keeps only pages on this machine, absolute paths and real ports', () => {
    const settings = readSettings({
      origins: ['https://wheelhouse.example', 'file:///x', 'nonsense'],
      bin: 'bin/docket',
      roots: { shop: 'relative/dir', web: '/abs/web' },
      ports: { shop: 80, web: 4400, api: 4400.5 }
    })
    expect(settings).toEqual({ bin: null, roots: { web: '/abs/web' }, ports: { web: 4400 }, origins: DEFAULT_ORIGINS })
  })

  it('takes a docket CLI by absolute path, or by a name found on PATH', () => {
    expect(readSettings({ bin: '/opt/docket' }).bin).toBe('/opt/docket')
    expect(readSettings({ bin: 'docket' }).bin).toBe('docket')
    expect(readSettings({ bin: '../docket' }).bin).toBeNull()
    expect(readSettings({}).bin).toBeNull()
  })

  it('reads an origin as docket open does', () => {
    expect(pageOrigin('http://localhost:4310/')).toBe('http://localhost:4310')
    expect(pageOrigin('http://[::1]:4310')).toBe('http://[::1]:4310')
    expect(pageOrigin('http://127.0.0.1:4310/plugins')).toBeNull()
    expect(pageOrigin(4310)).toBeNull()
  })

  it('asks for the same port for a project every time, in 4381-4780', () => {
    expect(preferredPort('shop')).toBe(preferredPort('shop'))
    for (const id of ['shop', 'web', 'a-very-long-project-name']) {
      expect(preferredPort(id)).toBeGreaterThanOrEqual(4381)
      expect(preferredPort(id)).toBeLessThanOrEqual(4780)
    }
  })

  it('knows a docket open that can allow Wheelhouse’s page, and one that can start a docket', () => {
    expect(allowsOrigins(HELP_NOW)).toBe(true)
    expect(allowsOrigins(HELP_OLD)).toBe(false)
    expect(startsDockets(HELP_NOW)).toBe(true)
    expect(startsDockets(HELP_NO_INIT)).toBe(false)
  })

  it('reads the version docket --version prints', () => {
    expect(versionOf('0.6.0\n')).toBe('0.6.0')
    expect(versionOf('1.0.0-rc.1')).toBe('1.0.0-rc.1')
    expect(versionOf("error: unknown option '--version'")).toBeNull()
  })
})

describe('the casebook tab’s provider', () => {
  it('says where the docket is and which pages its viewer allows', async () => {
    const { ctx, calls } = fake()
    const result = await provider.fetch(ctx)
    expect(result).toMatchObject({ available: true, source: 'the project’s docket' })
    const value = result.available ? result.value : null
    expect(value).toEqual({
      schema: CASEBOOK_SCHEMA,
      state: 'docket',
      root: '/work/shop',
      configuredRoot: false,
      origins: DEFAULT_ORIGINS,
      problem: null,
      docket: { source: 'plugin', version: docketVersion, command: SHIPPED.join(' ') }
    })
    // What the element reads.
    expect(isCasebookData(value)).toBe(true)
    // The docket the plugin ships is its own commit's: nothing to ask it.
    expect(calls).toEqual([])
  })

  it('asks a docket CLI the settings name for its version and whether it can serve Wheelhouse', async () => {
    const { ctx, calls } = fake({ settings: { bin: 'docket' } })
    const result = await provider.fetch(ctx)
    expect(result).toMatchObject({ available: true, value: { problem: null, docket: { source: 'settings', version: '0.6.0', command: 'docket' } } })
    expect(calls).toEqual([
      { argv: ['docket', 'open', '--help'], cwd: 'project', project: 'shop', timeoutMs: 5_000, maxBytes: 65_536 },
      { argv: ['docket', '--version'], cwd: 'project', project: 'shop', timeoutMs: 5_000, maxBytes: 65_536 }
    ])
  })

  it('is not available, so the tab does not show, for a project that keeps no docket', async () => {
    const result = await provider.fetch(fake({ files: [] }).ctx)
    expect(result).toEqual({ available: false, reason: 'This project has no docket. Add it from the Docket page in Wheelhouse’s menu.' })
  })

  it('shows a docket set in the plugins file instead of the clone’s', async () => {
    const result = await provider.fetch(fake({ files: [], settings: { roots: { shop: '/examples/acme' } } }).ctx)
    expect(result).toMatchObject({
      available: true,
      value: { state: 'docket', root: '/examples/acme', configuredRoot: true },
      source: 'the docket at /examples/acme, set in Wheelhouse’s plugins file'
    })
  })

  it('says plainly, with its version, when the docket the settings name is too old, or missing', async () => {
    const unknown = { ok: false, reason: 'exit 1', stdout: '', stderr: "error: unknown option '--version'" } as const
    const old = await provider.fetch(fake({ help: { ok: true, stdout: HELP_OLD }, version: unknown, settings: { bin: '/opt/docket' } }).ctx)
    expect(old).toMatchObject({
      available: true,
      value: { problem: expect.stringContaining('(/opt/docket) is too old to be shown in Wheelhouse'), docket: { source: 'settings', version: null } }
    })
    expect(old.available && (old.value as { problem: string }).problem).toContain(`remove "bin" to run the docket this plugin ships (${docketVersion})`)
    clearCliCache()
    const older = await provider.fetch(fake({ help: { ok: true, stdout: HELP_OLD }, version: { ok: true, stdout: '0.3.0\n' }, settings: { bin: '/opt/docket' } }).ctx)
    expect(older).toMatchObject({ available: true, value: { problem: expect.stringContaining('(/opt/docket, docket 0.3.0) is too old') } })
    clearCliCache()
    const missing = await provider.fetch(
      fake({ help: { ok: false, reason: 'spawn docket ENOENT', stdout: '', stderr: '' }, settings: { bin: '/opt/docket' } }).ctx
    )
    expect(missing).toMatchObject({ available: true, value: { problem: expect.stringContaining('could not find the docket CLI (/opt/docket)') } })
  })

  it('is not available for a project with no clone', async () => {
    expect(await provider.fetch(fake({ project: project({ path: null }) }).ctx)).toEqual({
      available: false,
      reason: 'Firstmate has not recorded a clone for this project.'
    })
  })
})

describe('the viewer service', () => {
  it('starts the docket it ships, on loopback, on the project’s port, allowing Wheelhouse’s page', async () => {
    const resolution = await service.resolve(fake().ctx)
    const port = preferredPort('shop')
    const url = `http://127.0.0.1:${port}`
    expect(resolution).toEqual({
      available: true,
      hint: openCommand(SHIPPED, '/work/shop', port, DEFAULT_ORIGINS),
      spec: {
        url,
        health: `${url}/api/health`,
        identity: { url: `${url}/api/health`, path: ['root'], value: '/work/shop' },
        argv: [
          ...SHIPPED,
          'open',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--no-open',
          '--allow-origin',
          'http://127.0.0.1:4310',
          '--allow-origin',
          'http://localhost:4310'
        ],
        cwd: '/work/shop',
        binds: 'loopback'
      }
    })
    expect(openCommand(['docket'], '/work/my shop', 4400, ['http://127.0.0.1:4310'])).toBe(
      "cd '/work/my shop' && docket open --host 127.0.0.1 --port 4400 --allow-origin http://127.0.0.1:4310"
    )
  })

  it('uses the port, CLI and pages the plugins file sets', async () => {
    const resolution = await service.resolve(
      fake({ settings: { ports: { shop: 4400 }, bin: '/opt/docket', origins: ['http://127.0.0.1:5173'] } }).ctx
    )
    expect(resolution).toMatchObject({
      available: true,
      spec: {
        url: 'http://127.0.0.1:4400',
        argv: ['/opt/docket', 'open', '--host', '127.0.0.1', '--port', '4400', '--no-open', '--allow-origin', 'http://127.0.0.1:5173']
      }
    })
  })

  it('does not start a docket too old for Wheelhouse’s page, and says how to start one by hand', async () => {
    const resolution = await service.resolve(fake({ help: { ok: true, stdout: HELP_OLD }, settings: { bin: 'docket' } }).ctx)
    expect(resolution).toMatchObject({
      available: false,
      reason: expect.stringContaining('too old'),
      hint: expect.stringContaining('docket open --host 127.0.0.1')
    })
  })

  it('does not start a missing docket', async () => {
    const resolution = await service.resolve(fake({ help: { ok: false, reason: 'spawn /opt/docket ENOENT', stdout: '', stderr: '' }, settings: { bin: '/opt/docket' } }).ctx)
    expect(resolution).toMatchObject({ available: false, reason: expect.stringContaining('could not find the docket CLI (/opt/docket)') })
  })

  it('starts a docket first for a project that has none: Add Docket', async () => {
    const resolution = await service.resolve(fake({ files: [] }).ctx)
    const port = preferredPort('shop')
    expect(resolution).toMatchObject({
      available: true,
      hint: openCommand(SHIPPED, '/work/shop', port, DEFAULT_ORIGINS, true),
      spec: { cwd: '/work/shop', argv: [...SHIPPED, ...viewerArgsFor(port), '--init'] }
    })
    expect(openCommand(['docket'], '/work/shop', 4400, ['http://127.0.0.1:4310'], true)).toBe(
      'cd /work/shop && docket open --host 127.0.0.1 --port 4400 --allow-origin http://127.0.0.1:4310 --init'
    )
    // A project with a docket is only opened.
    const opened = await service.resolve(fake().ctx)
    expect(opened.available && opened.spec.argv).not.toContain('--init')
  })

  it('does not add docket with a docket CLI too old to start one, but still opens an existing docket with it', async () => {
    const settings = { bin: '/opt/docket' }
    const old = await service.resolve(fake({ files: [], help: { ok: true, stdout: HELP_NO_INIT }, settings }).ctx)
    expect(old).toMatchObject({
      available: false,
      reason: expect.stringContaining('(/opt/docket, docket 0.6.0) is too old to add docket to a project'),
      hint: expect.stringContaining('--init')
    })
    expect(await service.resolve(fake({ help: { ok: true, stdout: HELP_NO_INIT }, settings }).ctx)).toMatchObject({ available: true })
  })

  it('is not available for a project with no clone', async () => {
    expect(await service.resolve(fake({ project: project({ path: null }) }).ctx)).toEqual({
      available: false,
      reason: 'Firstmate has not recorded a clone for this project.'
    })
  })
})

/** The viewer's arguments after the CLI, as the plugin starts it for the project's port and Wheelhouse's own pages. */
const viewerArgsFor = (port: number): string[] => [
  'open',
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
  '--no-open',
  '--allow-origin',
  'http://127.0.0.1:4310',
  '--allow-origin',
  'http://localhost:4310'
]

describe('the Docket page’s provider', () => {
  const shop = project()
  const web = project({ id: 'web', name: 'Web', path: '/work/web' })
  const notes = project({ id: 'notes', name: 'Notes', description: 'Loose notes', path: null })

  it('lists every project, in Wheelhouse’s order, with whether it keeps a docket', async () => {
    const { ctx, calls } = fake({ fleet: true, projects: [shop, web, notes], clones: { shop: ['.docket.yaml'], web: [] } })
    const result = await projectsProvider.fetch(ctx)
    expect(result).toMatchObject({ available: true, source: 'Wheelhouse’s projects and their clones' })
    expect(result.available && result.value).toEqual({
      schema: PROJECTS_SCHEMA,
      projects: [
        { id: 'shop', name: 'Shop', description: null, state: 'docket', root: '/work/shop', configuredRoot: false },
        { id: 'web', name: 'Web', description: null, state: 'none', root: '/work/web', configuredRoot: false },
        { id: 'notes', name: 'Notes', description: 'Loose notes', state: 'no-clone', root: null, configuredRoot: false }
      ],
      problem: null,
      docket: { source: 'plugin', version: docketVersion, command: SHIPPED.join(' ') }
    })
    expect(calls).toEqual([])
  })

  it('counts a docket set in the plugins file as the project’s', async () => {
    const result = await projectsProvider.fetch(
      fake({ fleet: true, projects: [notes], settings: { roots: { notes: '/examples/acme' } } }).ctx
    )
    expect(result.available && result.value).toMatchObject({
      projects: [{ id: 'notes', state: 'docket', root: '/examples/acme', configuredRoot: true }],
      docket: null
    })
  })

  it('says when the docket CLI the settings name cannot add docket, asking it in a clone', async () => {
    const { ctx, calls } = fake({
      fleet: true,
      projects: [notes, web],
      clones: { web: [] },
      help: { ok: true, stdout: HELP_NO_INIT },
      settings: { bin: '/opt/docket' }
    })
    const result = await projectsProvider.fetch(ctx)
    expect(result.available && result.value).toMatchObject({
      problem: expect.stringContaining('(/opt/docket, docket 0.6.0) is too old to add docket to a project: its docket open cannot start a docket (--init)'),
      docket: { source: 'settings', version: '0.6.0', command: '/opt/docket' }
    })
    expect(calls.map((call) => call.project)).toEqual(['web', 'web'])
  })

  it('lists no projects when the plugin is on for none', async () => {
    const result = await projectsProvider.fetch(fake({ fleet: true, projects: [] }).ctx)
    expect(result.available && result.value).toEqual({ schema: PROJECTS_SCHEMA, projects: [], problem: null, docket: null })
  })
})

/** A port nothing listens on. */
const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => done(port))
    })
  })

describe('the viewer, started as Wheelhouse starts it', () => {
  let dir: string
  let child: ChildProcess | undefined

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'docket-wheelhouse-'))
  })

  afterEach(async () => {
    child?.kill()
    child = undefined
    await rm(dir, { recursive: true, force: true })
  })

  it('answers Wheelhouse’s page, and only it, for the project’s docket', async () => {
    const root = path.join(dir, 'shop')
    await mkdir(root)
    await new Promise<void>((done, fail) => execFile(SHIPPED[0]!, [SHIPPED[1]!, 'init'], { cwd: root }, (error) => (error ? fail(error) : done())))

    // No "bin": the docket the plugin ships.
    const port = await freePort()
    const ctx: ServiceContext = {
      ...fake({ project: project({ path: root }), settings: { ports: { shop: port } } }).ctx,
      exec: (request) =>
        new Promise((done) =>
          execFile(request.argv[0]!, request.argv.slice(1), { cwd: root }, (error, stdout, stderr) =>
            done(error ? { ok: false, reason: error.message, stdout, stderr } : { ok: true, stdout })
          )
        )
    }
    const resolution = await service.resolve(ctx)
    if (!resolution.available) throw new Error(resolution.reason)
    const { spec } = resolution
    expect(spec.argv.slice(0, 2)).toEqual(SHIPPED)
    child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, stdio: 'ignore' })

    let health: Response | undefined
    for (let attempt = 0; attempt < 100 && !health; attempt++) {
      health = await fetch(spec.health, { headers: { origin: 'http://127.0.0.1:4310' } }).catch(() => undefined)
      if (!health) await new Promise((done) => setTimeout(done, 100))
    }
    if (!health) throw new Error('the viewer never answered')
    expect(health.status).toBe(200)
    const body = (await health.json()) as Record<string, unknown>
    // What Wheelhouse checks the viewer by.
    expect(body[spec.identity!.path[0]!]).toBe(spec.identity!.value)
    expect(spec.identity!.value).toBe(await realpath(root))
    expect(health.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4310')

    const other = await fetch(`${spec.url}/api/graph`, { headers: { origin: 'http://127.0.0.1:5173' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()

    // docket's MCP server, asked as Wheelhouse's MCP client asks it: Streamable HTTP, advertising MCP Apps.
    const mcp = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
      const response = await fetch(`${spec.url}${MCP_SERVER.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      })
      expect(response.status).toBe(200)
      const reply = (await response.json()) as { result?: Record<string, unknown>; error?: { message: string } }
      if (!reply.result) throw new Error(reply.error?.message ?? 'no result')
      return reply.result
    }
    const init = await mcp('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      clientInfo: { name: 'wheelhouse', version: '0' }
    })
    expect(init.protocolVersion).toBe('2025-11-25')
    const { tools } = (await mcp('tools/list')) as { tools: { name: string; _meta: { ui: { resourceUri: string } } }[] }
    expect(tools.map((tool) => tool.name)).toEqual(['docket_search'])
    const { contents } = (await mcp('resources/read', { uri: tools[0]!._meta.ui.resourceUri })) as { contents: { mimeType: string; text: string }[] }
    expect(contents[0]!.mimeType).toBe('text/html;profile=mcp-app')
    expect(contents[0]!.text).toMatch(/^<!doctype html>/)
    const found = (await mcp('tools/call', { name: 'docket_search', arguments: { query: 'anything' } })) as { structuredContent: { schema: string; project: { root: string } } }
    expect(found.structuredContent.schema).toBe('docket-search.v1')

    // docket's own page, which Launch opens.
    const page = await fetch(`${spec.url}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toMatch(/<html/i)
  }, 30_000)

  it('adds docket to a project that has none, then serves it: Add Docket', async () => {
    const root = path.join(dir, 'web')
    await mkdir(root)
    await writeFile(path.join(root, '.gitignore'), 'node_modules\n')
    const port = await freePort()
    const resolution = await service.resolve(fake({ project: project({ id: 'web', path: root }), files: [], settings: { ports: { web: port } } }).ctx)
    if (!resolution.available) throw new Error(resolution.reason)
    const { spec } = resolution
    expect(spec.argv.at(-1)).toBe('--init')
    child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, stdio: 'ignore' })

    let health: Response | undefined
    for (let attempt = 0; attempt < 100 && !health; attempt++) {
      health = await fetch(spec.health).catch(() => undefined)
      if (!health) await new Promise((done) => setTimeout(done, 100))
    }
    if (!health) throw new Error('the viewer never answered')
    expect(((await health.json()) as { root: string }).root).toBe(spec.identity!.value)
    // What docket init writes, the clone's .gitignore amended.
    for (const file of ['.docket.yaml', '.docket/entities.yaml']) expect(existsSync(path.join(root, file))).toBe(true)
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toContain('.docket/.index/')
  }, 30_000)

  it('asks a docket CLI the settings name for its version, for real', async () => {
    // The shipped CLI, as an executable the way an installed docket is.
    const bin = path.join(dir, 'docket')
    await writeFile(bin, `#!/bin/sh\nexec "${SHIPPED[0]}" "${SHIPPED[1]}" "$@"\n`)
    await chmod(bin, 0o755)
    const ctx: ServiceContext = {
      ...fake({ settings: { bin } }).ctx,
      exec: (request) =>
        new Promise((done) =>
          execFile(request.argv[0]!, request.argv.slice(1), (error, stdout, stderr) =>
            done(error ? { ok: false, reason: error.message, stdout, stderr } : { ok: true, stdout })
          )
        )
    }
    expect(await provider.fetch(ctx)).toMatchObject({
      available: true,
      value: { problem: null, docket: { source: 'settings', version: docketVersion, command: bin } }
    })
  })
})
