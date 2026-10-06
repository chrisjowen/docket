import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI_SPEC, setup, type SetupOptions } from './setup.js'

/**
 * Stands in for `claude` and `npm`: records its argv, answers the `--json`
 * listings from files the test writes, and fails when told to.
 */
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify({
  name: require('node:path').basename(process.argv[1]),
  argv
}) + '\\n')
const joined = argv.join(' ')
if (process.env.FAKE_FAIL && joined.includes(process.env.FAKE_FAIL)) process.exit(1)
const listing = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]'
if (joined === 'plugin marketplace list --json') process.stdout.write(listing(process.env.FAKE_MARKETPLACES))
if (joined === 'plugin list --json') process.stdout.write(listing(process.env.FAKE_PLUGINS))
`

interface Box {
  dir: string
  repo: string
  bin: string
  env: NodeJS.ProcessEnv
  calls: () => Promise<string[][]>
  marketplaces: (entries: unknown[]) => Promise<void>
  plugins: (entries: unknown[]) => Promise<void>
}

const boxes: string[] = []
afterEach(async () => {
  for (const dir of boxes.splice(0)) await rm(dir, { recursive: true, force: true })
})

/**
 * A scratch repository and a PATH holding only fakes and the system
 * directories, so no real `claude`, `npm` or `docket` is ever reached.
 */
const sandbox = async ({ claude = true } = {}): Promise<Box> => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'docket-setup-')))
  boxes.push(dir)
  const repo = join(dir, 'repo')
  const bin = join(dir, 'bin')
  await mkdir(repo, { recursive: true })
  await mkdir(bin, { recursive: true })
  await symlink(process.execPath, join(bin, 'node'))
  for (const name of claude ? ['claude', 'npm'] : ['npm']) {
    await writeFile(join(bin, name), FAKE)
    await chmod(join(bin, name), 0o755)
  }
  const callsFile = join(dir, 'calls.jsonl')
  const env = {
    PATH: [bin, '/usr/bin', '/bin'].join(delimiter),
    HOME: dir,
    FAKE_CALLS: callsFile,
    FAKE_MARKETPLACES: join(dir, 'marketplaces.json'),
    FAKE_PLUGINS: join(dir, 'plugins.json')
  }
  return {
    dir,
    repo,
    bin,
    env,
    calls: async () =>
      existsSync(callsFile)
        ? (await readFile(callsFile, 'utf8'))
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const call = JSON.parse(line) as { name: string; argv: string[] }
              return [call.name, ...call.argv]
            })
        : [],
    marketplaces: (entries) => writeFile(env.FAKE_MARKETPLACES, JSON.stringify(entries)),
    plugins: (entries) => writeFile(env.FAKE_PLUGINS, JSON.stringify(entries))
  }
}

const quiet = (): void => {}

/** Runs setup in the box, without a terminal unless told otherwise. */
const run = (box: Box, options: SetupOptions = {}) =>
  setup({
    cwd: box.repo,
    env: box.env,
    interactive: false,
    ask: () => {
      throw new Error('asked a question without a terminal')
    },
    log: quiet,
    ...options
  })

const DOCKET_MARKETPLACE = { name: 'docket', source: 'github', repo: 'chrisjowen/docket' }

describe('setup', () => {
  it('installs the marketplace and the plugin for the user', async () => {
    const box = await sandbox()

    const result = await run(box)

    expect(await box.calls()).toEqual([
      ['claude', 'plugin', 'marketplace', 'list', '--json'],
      ['claude', 'plugin', 'marketplace', 'add', 'chrisjowen/docket'],
      ['claude', 'plugin', 'list', '--json'],
      ['claude', 'plugin', 'install', 'docket@docket', '--scope', 'user']
    ])
    expect(result.ok).toBe(true)
    expect(result.steps.find((step) => step.name === 'plugin')).toMatchObject({
      outcome: 'done'
    })
    expect(result.next).toContain('Restart Claude Code, or run /reload-plugins, to load the plugin.')
  })

  it('never accepts a marketplace command on the developer\'s behalf', async () => {
    const box = await sandbox()

    await run(box, { yes: true, team: true })

    for (const call of await box.calls()) {
      expect(call).not.toContain('-y')
      expect(call).not.toContain('--yes')
      expect(call).not.toContain('--accept-command')
    }
  })

  it('updates what is already installed rather than adding it again', async () => {
    const box = await sandbox()
    await box.marketplaces([DOCKET_MARKETPLACE])
    await box.plugins([{ id: 'docket@docket', scope: 'user', enabled: true }])

    const result = await run(box)

    expect(await box.calls()).toEqual([
      ['claude', 'plugin', 'marketplace', 'list', '--json'],
      ['claude', 'plugin', 'marketplace', 'update', 'docket'],
      ['claude', 'plugin', 'list', '--json'],
      ['claude', 'plugin', 'update', 'docket@docket', '--scope', 'user']
    ])
    expect(result.ok).toBe(true)
  })

  it('prints the /plugin commands when Claude Code is not on the path', async () => {
    const box = await sandbox({ claude: false })

    const result = await run(box)

    expect(await box.calls()).toEqual([])
    expect(result.steps.find((step) => step.name === 'plugin')).toMatchObject({
      outcome: 'manual'
    })
    expect(result.next).toEqual(
      expect.arrayContaining([
        '  /plugin marketplace add chrisjowen/docket',
        '  /plugin install docket@docket'
      ])
    )
    expect(result.ok).toBe(true)
  })

  it('stops at a marketplace that cannot be added, and reports failure', async () => {
    const box = await sandbox()
    box.env.FAKE_FAIL = 'marketplace add'

    const result = await run(box)

    const calls = await box.calls()
    expect(calls.some((call) => call.includes('install'))).toBe(false)
    expect(result.steps.find((step) => step.name === 'marketplace')).toMatchObject({
      outcome: 'failed'
    })
    expect(result.ok).toBe(false)
  })

  describe('--team', () => {
    it('declares the marketplace and installs the plugin in the repository', async () => {
      const box = await sandbox()

      const result = await run(box, { team: true })

      expect(await box.calls()).toEqual([
        ['claude', 'plugin', 'marketplace', 'list', '--json'],
        ['claude', 'plugin', 'marketplace', 'add', 'chrisjowen/docket', '--scope', 'project'],
        ['claude', 'plugin', 'list', '--json'],
        ['claude', 'plugin', 'install', 'docket@docket', '--scope', 'project']
      ])
      expect(result.next).toContain(
        'Commit .claude/settings.json, so everyone who clones the repository is offered the plugin.'
      )
    })

    it('declares the marketplace in the repository even when the user already has it', async () => {
      const box = await sandbox()
      await box.marketplaces([DOCKET_MARKETPLACE])
      await box.plugins([{ id: 'docket@docket', scope: 'user', enabled: true }])

      await run(box, { team: true })

      const calls = await box.calls()
      expect(calls).toContainEqual([
        'claude', 'plugin', 'marketplace', 'add', 'chrisjowen/docket', '--scope', 'project'
      ])
      // Installed for the user is not installed for the repository.
      expect(calls).toContainEqual([
        'claude', 'plugin', 'install', 'docket@docket', '--scope', 'project'
      ])
    })

    it('updates a repository that already offers the plugin', async () => {
      const box = await sandbox()
      await mkdir(join(box.repo, '.claude'))
      await writeFile(
        join(box.repo, '.claude', 'settings.json'),
        JSON.stringify({
          extraKnownMarketplaces: { docket: { source: { source: 'github', repo: 'chrisjowen/docket' } } },
          enabledPlugins: { 'docket@docket': true }
        })
      )
      await box.marketplaces([DOCKET_MARKETPLACE])
      await box.plugins([
        { id: 'docket@docket', scope: 'project', enabled: true, projectPath: join(box.dir, 'elsewhere') },
        { id: 'docket@docket', scope: 'project', enabled: true, projectPath: box.repo }
      ])

      await run(box, { team: true })

      expect((await box.calls()).filter((call) => !call.includes('--json'))).toEqual([
        ['claude', 'plugin', 'marketplace', 'update', 'docket'],
        ['claude', 'plugin', 'update', 'docket@docket', '--scope', 'project']
      ])
    })
  })

  describe('the repository', () => {
    it('is not initialized without a terminal unless --yes', async () => {
      const box = await sandbox()

      const result = await run(box)

      expect(existsSync(join(box.repo, '.docket.yaml'))).toBe(false)
      expect(result.steps.find((step) => step.name === 'repository')).toMatchObject({
        outcome: 'skipped'
      })
      expect(result.next.join('\n')).toMatch(/docket init/)
    })

    it('is initialized with --yes', async () => {
      const box = await sandbox()

      const result = await run(box, { yes: true })

      expect(existsSync(join(box.repo, '.docket.yaml'))).toBe(true)
      expect(existsSync(join(box.repo, '.docket', 'entities.yaml'))).toBe(true)
      expect(result.steps.find((step) => step.name === 'repository')).toMatchObject({
        outcome: 'done'
      })
    })

    it('is offered on a terminal, recommending yes', async () => {
      const box = await sandbox()
      const questions: [string, boolean][] = []

      await run(box, {
        interactive: true,
        ask: async (question, recommended) => {
          questions.push([question, recommended])
          return recommended
        }
      })

      expect(questions[0]?.[0]).toMatch(/Set up docket in/)
      expect(questions[0]?.[1]).toBe(true)
      expect(existsSync(join(box.repo, '.docket.yaml'))).toBe(true)
    })

    it('is never offered with --no-init', async () => {
      const box = await sandbox()
      const questions: string[] = []

      await run(box, {
        init: false,
        interactive: true,
        ask: async (question) => {
          questions.push(question)
          return false
        }
      })

      expect(questions.some((question) => /Set up docket/.test(question))).toBe(false)
      expect(existsSync(join(box.repo, '.docket.yaml'))).toBe(false)
    })

    it('is left alone when it is already set up', async () => {
      const box = await sandbox()
      await writeFile(join(box.repo, '.docket.yaml'), 'version: 1\n')

      const result = await run(box, { yes: true })

      expect(await readFile(join(box.repo, '.docket.yaml'), 'utf8')).toBe('version: 1\n')
      expect(result.steps.find((step) => step.name === 'repository')).toMatchObject({
        outcome: 'skipped'
      })
    })
  })

  describe('the global CLI', () => {
    it('is skipped without a terminal, even with --yes', async () => {
      const box = await sandbox()

      const result = await run(box, { yes: true })

      expect((await box.calls()).some(([name]) => name === 'npm')).toBe(false)
      expect(result.steps.find((step) => step.name === 'cli')?.detail).toContain(
        `npm install -g ${CLI_SPEC}`
      )
    })

    it('is offered on a terminal, recommending no', async () => {
      const box = await sandbox()
      const questions: [string, boolean][] = []

      await run(box, {
        interactive: true,
        ask: async (question, recommended) => {
          questions.push([question, recommended])
          return true
        }
      })

      const offer = questions.find(([question]) => /globally/.test(question))
      expect(offer?.[1]).toBe(false)
      expect(await box.calls()).toContainEqual(['npm', 'install', '-g', CLI_SPEC])
    })

    it('is installed with --global', async () => {
      const box = await sandbox()

      const result = await run(box, { global: true })

      expect(await box.calls()).toContainEqual(['npm', 'install', '-g', CLI_SPEC])
      expect(result.steps.find((step) => step.name === 'cli')).toMatchObject({ outcome: 'done' })
    })

    it('is not offered when docket is already installed', async () => {
      const box = await sandbox()
      await writeFile(join(box.bin, 'docket'), '#!/bin/sh\n')
      await chmod(join(box.bin, 'docket'), 0o755)

      const result = await run(box, {
        interactive: true,
        init: false,
        ask: () => {
          throw new Error('should not ask')
        }
      })

      expect(result.steps.find((step) => step.name === 'cli')?.detail).toMatch(/already on the path/)
    })

    it('does not count the docket npx is running as installed', async () => {
      const box = await sandbox()
      const npxBin = join(box.dir, '.npm', '_npx', 'abc123', 'node_modules', '.bin')
      await mkdir(npxBin, { recursive: true })
      await writeFile(join(npxBin, 'docket'), '#!/bin/sh\n')
      await chmod(join(npxBin, 'docket'), 0o755)
      box.env.PATH = [npxBin, box.env.PATH].join(delimiter)

      const result = await run(box, { global: true })

      expect(await box.calls()).toContainEqual(['npm', 'install', '-g', CLI_SPEC])
      expect(result.steps.find((step) => step.name === 'cli')).toMatchObject({ outcome: 'done' })
    })
  })
})
