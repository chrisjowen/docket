import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { delimiter, join, resolve, sep } from 'node:path'
import { CONFIG_FILENAME } from '../config/config.js'
import { findConfigFile } from '../config/loader.js'
import { init } from './init.js'

/** Where the plugin comes from: the GitHub repository that hosts its marketplace. */
export const MARKETPLACE_SOURCE = 'chrisjowen/docket'
export const MARKETPLACE = 'docket'
export const PLUGIN = 'docket@docket'

const MANIFEST = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { name: string; version: string }

/** What `npm i -g` installs: this very release, so shell and plugin agree. */
export const CLI_SPEC = `${MANIFEST.name}@${MANIFEST.version}`

export interface SetupOptions {
  /** Where to set up. Defaults to the process working directory. */
  cwd?: string | undefined
  /** Install the plugin for the repository, so everyone who clones it is offered it. */
  team?: boolean | undefined
  /** Take the recommended answer to every question without asking. */
  yes?: boolean | undefined
  /** `false` never offers `docket init`. */
  init?: boolean | undefined
  /** `true` installs the CLI globally without asking; `false` never offers it. */
  global?: boolean | undefined
  /** Whether questions may be asked. Defaults to stdin and stdout both being terminals. */
  interactive?: boolean | undefined
  /** Asks a yes/no question; `recommended` is the answer an empty reply means. */
  ask?: ((question: string, recommended: boolean) => Promise<boolean>) | undefined
  /** Environment for finding and running `claude`, `npm` and `git`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | undefined
  /** Progress output. Defaults to stdout. */
  log?: ((line: string) => void) | undefined
}

export type StepOutcome = 'done' | 'skipped' | 'failed' | 'manual'

export interface SetupStep {
  name: string
  outcome: StepOutcome
  detail: string
}

/** What `setup` did, step by step, plus what the developer should do next. */
export interface SetupResult {
  projectRoot: string
  steps: SetupStep[]
  next: string[]
  ok: boolean
}

const EXE = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** The first `name` on `PATH` in a directory `accept` allows, or undefined. */
export const which = (
  name: string,
  env: NodeJS.ProcessEnv,
  accept: (dir: string) => boolean = () => true
): string | undefined => {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || !accept(dir)) continue
    for (const ext of EXE) {
      const file = join(dir, `${name}${ext}`)
      if (isExecutable(file)) return file
    }
  }
  return undefined
}

/**
 * Whether a `docket` in `dir` is one the developer installed. npx and package
 * scripts put a project's or npx's own `node_modules/.bin` on the path, and a
 * `docket` there is gone once the command ends.
 */
const isInstalledBinDir = (dir: string): boolean => {
  const normalized = resolve(dir)
  return (
    !normalized.endsWith(`${sep}node_modules${sep}.bin`) &&
    !normalized.includes(`${sep}_npx${sep}`)
  )
}

const canonical = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const askOnTerminal = async (question: string, recommended: boolean): Promise<boolean> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await prompt.question(`${question} ${recommended ? '[Y/n]' : '[y/N]'} `))
      .trim()
      .toLowerCase()
    return answer === '' ? recommended : answer.startsWith('y')
  } finally {
    prompt.close()
  }
}

/** The repository being set up: the one already holding docket, else the git checkout, else `cwd`. */
const findProjectRoot = (cwd: string, env: NodeJS.ProcessEnv): string => {
  const config = findConfigFile(cwd)
  if (config) return resolve(config, '..')
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, env, encoding: 'utf8' })
  const top = git.status === 0 ? git.stdout.trim() : ''
  return top === '' ? resolve(cwd) : top
}

/**
 * One command for everything docket needs: the Claude Code plugin, docket in
 * this repository, and optionally the CLI on the developer's path.
 *
 * Every step is idempotent - an existing marketplace or plugin is updated, an
 * existing `.docket.yaml` is left alone - so running it again is safe. Without
 * a terminal nothing is asked: the plugin is installed, and every offer takes
 * its default unless `yes` is set (init) or `global` is (the global CLI).
 */
export const setup = async (options: SetupOptions = {}): Promise<SetupResult> => {
  const env = options.env ?? process.env
  const log = options.log ?? ((line: string) => console.log(line))
  const interactive =
    options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const ask = options.ask ?? askOnTerminal
  const team = options.team ?? false
  const scope = team ? 'project' : 'user'
  const projectRoot = findProjectRoot(options.cwd ?? process.cwd(), env)

  const steps: SetupStep[] = []
  const next: string[] = []
  const record = (name: string, outcome: StepOutcome, detail: string): void => {
    steps.push({ name, outcome, detail })
  }

  /** Runs a command where the developer can see it; true when it succeeded. */
  const run = (command: string, args: string[]): boolean => {
    log(`$ ${[command, ...args].join(' ')}`)
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    return result.status === 0
  }

  const capture = (command: string, args: string[]): unknown => {
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    return result.status === 0 ? readJson(result.stdout) : undefined
  }

  // 1. The Claude Code plugin, through the `claude` CLI when there is one.
  const claude = which('claude', env)
  if (claude) {
    installPlugin(claude)
  } else {
    record(
      'plugin',
      'manual',
      'Claude Code (`claude`) is not on the path; install the plugin from inside Claude Code'
    )
    next.push(
      'In Claude Code, run:',
      `  /plugin marketplace add ${MARKETPLACE_SOURCE}`,
      `  /plugin install ${PLUGIN}`,
      ...(team
        ? ['  and choose project scope, so the repository offers it to everyone who clones it']
        : [])
    )
  }

  // 2. docket in this repository.
  await initRepository()

  // 3. The CLI on the developer's own path. Claude Code never needs it: the
  // plugin runs the CLI through npx when none is installed.
  await installGlobalCli()

  if (steps.some((step) => step.name === 'plugin' && step.outcome === 'done')) {
    if (team) {
      next.push(
        'Commit .claude/settings.json, so everyone who clones the repository is offered the plugin.'
      )
    }
    next.push('Restart Claude Code, or run /reload-plugins, to load the plugin.')
  }

  const ok = steps.every((step) => step.outcome !== 'failed')
  return { projectRoot, steps, next, ok }

  function installPlugin(claude: string): void {
    const marketplaces = capture(claude, ['plugin', 'marketplace', 'list', '--json'])
    const known =
      Array.isArray(marketplaces) &&
      marketplaces.some((entry: { name?: unknown }) => entry?.name === MARKETPLACE)
    // For a team the repository must declare the marketplace itself, so a
    // fresh clone can find the plugin it enables.
    const declared = !team || projectDeclaresMarketplace()

    const marketplaceOk =
      known && declared
        ? run(claude, ['plugin', 'marketplace', 'update', MARKETPLACE])
        : run(claude, [
            'plugin',
            'marketplace',
            'add',
            MARKETPLACE_SOURCE,
            ...(team ? ['--scope', 'project'] : [])
          ])
    const marketplaceDone = known && declared ? 'refreshed' : 'added'
    if (!marketplaceOk) {
      record('marketplace', 'failed', `could not add ${MARKETPLACE_SOURCE}; see the output above`)
      record('plugin', 'skipped', 'needs the marketplace')
      return
    }
    record(
      'marketplace',
      'done',
      `${marketplaceDone} ${MARKETPLACE_SOURCE}${team ? ' (declared in .claude/settings.json)' : ''}`
    )

    const installed = isPluginInstalled(capture(claude, ['plugin', 'list', '--json']))
    const verb = installed ? 'update' : 'install'
    if (run(claude, ['plugin', verb, PLUGIN, '--scope', scope])) {
      record(
        'plugin',
        'done',
        installed
          ? `${PLUGIN} already installed (${scope} scope); checked for updates`
          : `installed ${PLUGIN} (${scope} scope)`
      )
    } else {
      record('plugin', 'failed', `could not ${verb} ${PLUGIN}; see the output above`)
    }
  }

  function projectDeclaresMarketplace(): boolean {
    const file = join(projectRoot, '.claude', 'settings.json')
    if (!existsSync(file)) return false
    const settings = readJson(readFileSync(file, 'utf8')) as
      | { extraKnownMarketplaces?: Record<string, unknown> }
      | undefined
    return Boolean(settings?.extraKnownMarketplaces?.[MARKETPLACE])
  }

  function isPluginInstalled(plugins: unknown): boolean {
    if (!Array.isArray(plugins)) return false
    const root = canonical(projectRoot)
    return plugins.some(
      (plugin: { id?: unknown; scope?: unknown; projectPath?: unknown }) =>
        plugin?.id === PLUGIN &&
        plugin.scope === scope &&
        (scope === 'user' ||
          (typeof plugin.projectPath === 'string' && canonical(plugin.projectPath) === root))
    )
  }

  async function initRepository(): Promise<void> {
    if (existsSync(join(projectRoot, CONFIG_FILENAME))) {
      record('repository', 'skipped', `already set up (${CONFIG_FILENAME} exists)`)
      return
    }
    if (options.init === false) {
      record('repository', 'skipped', '--no-init')
      next.push('Run `docket init` to set up docket in this repository.')
      return
    }
    const accepted =
      options.yes === true ||
      (interactive &&
        (await ask(
          `Set up docket in ${projectRoot}? This creates ${CONFIG_FILENAME} and .docket/.`,
          true
        )))
    if (!accepted) {
      record(
        'repository',
        'skipped',
        interactive ? 'declined' : `no ${CONFIG_FILENAME}; not set up without --yes`
      )
      next.push('Run `docket init` (or `docket setup --yes`) to set up docket in this repository.')
      return
    }
    const result = await init({ cwd: projectRoot })
    record(
      'repository',
      'done',
      `initialized ${projectRoot} (created ${result.created.length} paths)`
    )
    next.push(`Commit ${CONFIG_FILENAME} and .docket/.`)
  }

  async function installGlobalCli(): Promise<void> {
    const existing = which('docket', env, isInstalledBinDir)
    if (existing) {
      record('cli', 'skipped', `docket is already on the path (${existing})`)
      return
    }
    const command = ['npm', 'install', '-g', CLI_SPEC]
    if (options.global === false) {
      record('cli', 'skipped', '--no-global')
      return
    }
    // Offered, never recommended: Claude Code runs the CLI through the plugin,
    // so this only puts `docket` in the developer's own shell.
    const accepted =
      options.global === true ||
      (interactive &&
        options.yes !== true &&
        (await ask(
          `Also install the docket CLI globally (${command.join(' ')}), so \`docket\` works in your shell?`,
          false
        )))
    if (!accepted) {
      record('cli', 'skipped', `not installed globally; for your shell: ${command.join(' ')}`)
      return
    }
    const npm = which('npm', env)
    if (npm && run(npm, command.slice(1))) {
      record('cli', 'done', `installed ${CLI_SPEC} globally`)
    } else {
      record('cli', 'failed', `could not run ${command.join(' ')}; see the output above`)
    }
  }
}
