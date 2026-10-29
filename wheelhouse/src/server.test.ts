import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isCasebookData } from '../../packages/docket-ui/src/embed/host.js'
import type { ExecRequest, ExecResult, Project, ServiceContext } from './contract.js'
import plugin, {
  allowsOrigins,
  CASEBOOK_SCHEMA,
  clearCliCache,
  DEFAULT_ORIGINS,
  openCommand,
  pageOrigin,
  preferredPort,
  readSettings
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
    enabledWhenFile: string
    contributions: { id: string; slot: string }[]
    services: { id: string; scope: string }[]
  }
}

const HELP_NOW = 'Usage: docket open [options]\n  --host <address>\n  --no-open\n  --allow-origin <origin>  another page on this machine\n'
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

/** A context like Wheelhouse's, with `exec` answering `docket open --help` and the clone holding `files`. */
const fake = (o: { project?: Project | null; help?: ExecResult; files?: string[]; settings?: Record<string, unknown> } = {}): Fake => {
  const calls: ExecRequest[] = []
  const p = o.project === undefined ? project() : o.project
  return {
    calls,
    ctx: {
      project: p,
      projects: p ? [p] : [],
      settings: o.settings ?? {},
      signal: new AbortController().signal,
      exec: async (request) => {
        calls.push(request)
        return o.help ?? { ok: true, stdout: HELP_NOW }
      },
      readFile: async (rel) => ((o.files ?? ['.docket.yaml']).includes(rel) ? '' : null),
      servicePort: async (preferred) => preferred
    }
  }
}

const provider = plugin.providers[0]!
const service = plugin.services[0]!

beforeEach(() => clearCliCache())

describe('the manifest', () => {
  it('lists exactly the contributions and services the server entry has', () => {
    expect(manifest.name).toBe('docket')
    expect(manifest.wheelhouse.contributions).toEqual(plugin.contributions.map(({ id, slot }) => ({ id, slot })))
    expect(manifest.wheelhouse.services).toEqual(plugin.services.map(({ id, scope }) => ({ id, scope })))
    expect(manifest.wheelhouse.apiVersion).toBe(1)
    expect(manifest.wheelhouse.enabledWhenFile).toBe('.docket.yaml')
  })

  it('names entries that exist, and the built server entry is this one', async () => {
    expect(existsSync(path.join(repo, manifest.wheelhouse.server))).toBe(true)
    expect(existsSync(path.join(repo, manifest.wheelhouse.ui))).toBe(true)
    const built = (await import(path.join(repo, manifest.wheelhouse.server))).default as typeof plugin
    expect(built.contributions).toEqual(plugin.contributions)
    expect(built.services.map(({ id, scope, title }) => ({ id, scope, title }))).toEqual(
      plugin.services.map(({ id, scope, title }) => ({ id, scope, title }))
    )
    expect(built.providers.map(({ id, scope, ttlMs }) => ({ id, scope, ttlMs }))).toEqual(
      plugin.providers.map(({ id, scope, ttlMs }) => ({ id, scope, ttlMs }))
    )
  })

  it('draws the tab with an element the UI bundle defines, under the plugin’s own prefix', async () => {
    const bundle = await readFile(path.join(repo, manifest.wheelhouse.ui), 'utf8')
    for (const contribution of plugin.contributions) {
      expect(contribution.render.element.startsWith(`${manifest.name}-`)).toBe(true)
      expect(bundle).toContain(`"${contribution.render.element}"`)
    }
  })

  it('keeps its version with docket’s', async () => {
    const docket = JSON.parse(await readFile(path.join(repo, 'packages', 'docket', 'package.json'), 'utf8')) as { version: string }
    expect(manifest.version).toBe(docket.version)
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
      bin: 'docket',
      roots: { shop: 'relative/dir', web: '/abs/web' },
      ports: { shop: 80, web: 4400, api: 4400.5 }
    })
    expect(settings).toEqual({ bin: null, roots: { web: '/abs/web' }, ports: { web: 4400 }, origins: DEFAULT_ORIGINS })
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

  it('knows a docket open that can allow Wheelhouse’s page', () => {
    expect(allowsOrigins(HELP_NOW)).toBe(true)
    expect(allowsOrigins(HELP_OLD)).toBe(false)
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
      problem: null
    })
    // What the element reads.
    expect(isCasebookData(value)).toBe(true)
    expect(calls).toEqual([{ argv: ['docket', 'open', '--help'], cwd: 'project', project: 'shop', timeoutMs: 5_000, maxBytes: 65_536 }])
  })

  it('says when the project keeps no docket', async () => {
    const result = await provider.fetch(fake({ files: [] }).ctx)
    expect(result).toMatchObject({ available: true, value: { state: 'none', problem: null } })
  })

  it('shows a docket set in the plugins file instead of the clone’s', async () => {
    const result = await provider.fetch(fake({ files: [], settings: { roots: { shop: '/examples/acme' } } }).ctx)
    expect(result).toMatchObject({
      available: true,
      value: { state: 'docket', root: '/examples/acme', configuredRoot: true },
      source: 'the docket at /examples/acme, set in Wheelhouse’s plugins file'
    })
  })

  it('says plainly when docket is too old, or missing', async () => {
    const old = await provider.fetch(fake({ help: { ok: true, stdout: HELP_OLD } }).ctx)
    expect(old).toMatchObject({ available: true, value: { problem: expect.stringContaining('too old to be shown in Wheelhouse') } })
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
  it('starts docket open on loopback, on the project’s port, allowing Wheelhouse’s page', async () => {
    const resolution = await service.resolve(fake().ctx)
    const port = preferredPort('shop')
    const url = `http://127.0.0.1:${port}`
    expect(resolution).toEqual({
      available: true,
      hint: openCommand('docket', '/work/shop', port, DEFAULT_ORIGINS),
      spec: {
        url,
        health: `${url}/api/health`,
        identity: { url: `${url}/api/health`, path: ['root'], value: '/work/shop' },
        argv: [
          'docket',
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
    expect(openCommand('docket', '/work/my shop', 4400, ['http://127.0.0.1:4310'])).toBe(
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
    const resolution = await service.resolve(fake({ help: { ok: true, stdout: HELP_OLD } }).ctx)
    expect(resolution).toMatchObject({
      available: false,
      reason: expect.stringContaining('too old'),
      hint: expect.stringContaining('docket open --host 127.0.0.1')
    })
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

const cli = path.join(repo, 'packages', 'docket', 'dist', 'cli.js')

describe.skipIf(!existsSync(cli))('the viewer, started as Wheelhouse starts it', () => {
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
    // The built CLI, as an executable the way an installed docket is.
    const bin = path.join(dir, 'docket')
    await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`)
    await chmod(bin, 0o755)
    const root = path.join(dir, 'shop')
    await mkdir(root)
    await new Promise<void>((done, fail) => execFile(bin, ['init'], { cwd: root }, (error) => (error ? fail(error) : done())))

    const port = await freePort()
    const ctx: ServiceContext = {
      ...fake({ project: project({ path: root }), settings: { bin, ports: { shop: port } } }).ctx,
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
  }, 30_000)
})
