import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLI, type CliResult } from './helpers.js'

const run = promisify(execFile)

/**
 * Docket must behave exactly as it did before Docket Cloud with the network
 * blocked (G8): `DOCKET_OFFLINE` makes every request to a cloud throw before
 * it leaves the machine. Every pre-existing command over the example project
 * gives the same output with it set as without, and a project linked to a
 * cloud still searches, reporting the cloud as unavailable.
 */

const EXAMPLE = fileURLToPath(new URL('../../../examples/acme-platform', import.meta.url))

/** The commands docket had before `docket cloud`, in an order that exercises a synced index. */
const COMMANDS: string[][] = [
  ['validate'],
  ['ontology', 'list'],
  ['ontology', 'show', 'service'],
  ['config', 'migrate', '--dry-run'],
  ['adapters', 'list'],
  ['sync'],
  ['adapters', 'status'],
  ['search', 'orders'],
  ['ask', 'orders', '--no-synthesis'],
  ['graph', '--json'],
  ['rebuild']
]

let scratch: string
let home: string

/** A fresh copy of the example project, without any index, named as the example is: its name is in the output. */
const copyExample = async (name: string): Promise<string> => {
  const root = join(scratch, name, 'acme-platform')
  await cp(EXAMPLE, root, { recursive: true, filter: (source) => !source.includes(`${join('.docket', '.index')}`) })
  return root
}

/** `docket <args>` in `root`, with sessions kept apart from the user's, and `env` added. */
const docket = async (root: string, env: Record<string, string>, ...args: string[]): Promise<CliResult> => {
  if (!existsSync(CLI)) throw new Error(`${CLI} does not exist - run \`pnpm -C packages/docket build\` before the end-to-end tests.`)
  const { DOCKET_OFFLINE: _inherited, ...inherited } = process.env
  const environment = { ...inherited, XDG_CONFIG_HOME: home, DOCKET_KEYCHAIN: 'off', ...env }
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd: root, env: environment })
    return { code: 0, stdout, stderr }
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

/** Output with what differs between two runs - the copy's path, the time, durations - written alike. */
const normalized = (result: CliResult, root: string): CliResult => {
  const alike = (text: string): string =>
    text
      .replaceAll(root, '<root>')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>')
      .replace(/"durationMs": \d+/g, '"durationMs": <n>')
      .replace(/\b\d+(\.\d+)? ?m?s\b/g, '<duration>')
  return { code: result.code, stdout: alike(result.stdout), stderr: alike(result.stderr) }
}

beforeAll(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'docket-offline-')))
  home = join(scratch, 'config-home')
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('docket offline', () => {
  it('gives every pre-existing command the same output with the network blocked', async () => {
    const online = await copyExample('online')
    const offline = await copyExample('offline')

    for (const args of COMMANDS) {
      const before = normalized(await docket(online, {}, ...args), online)
      const after = normalized(await docket(offline, { DOCKET_OFFLINE: '1' }, ...args), offline)
      expect({ args, ...after }).toEqual({ args, ...before })
    }
  })

  it('searches a project linked to a cloud, reporting the cloud as unavailable', async () => {
    const root = await copyExample('linked')
    expect((await docket(root, {}, 'config', 'migrate', '--write')).code).toBe(0)
    const linked = await docket(root, { DOCKET_OFFLINE: '1' }, 'cloud', 'link', 'acme/platform')
    expect(linked.code).toBe(0)
    expect(linked.stdout).toContain('✓ linked to acme/platform on https://docket.chrisjowen.net: added adapter "cloud"')
    expect((await docket(root, { DOCKET_OFFLINE: '1' }, 'sync')).code).toBe(0)

    const result = await docket(root, { DOCKET_OFFLINE: '1' }, 'search', 'orders')

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('\ncloud\n  unavailable: network access is turned off (DOCKET_OFFLINE is set)')
    expect(result.stdout).toMatch(/\njsonl\n[^]*\n {2}service\.orders {2}/)
  })

  it('reports a linked project\'s status offline, without failing', async () => {
    const root = await copyExample('status')
    await docket(root, {}, 'config', 'migrate', '--write')
    await docket(root, {}, 'cloud', 'link', 'acme/platform')

    const result = await docket(root, { DOCKET_OFFLINE: '1' }, 'cloud', 'status')

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('linked    acme/platform on https://docket.chrisjowen.net (adapter "cloud")')
    expect(result.stdout).toContain('ontology  unknown: network access is turned off (DOCKET_OFFLINE is set)')
  })
})
