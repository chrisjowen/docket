#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

import { Command, Option } from 'commander'
import { adapterAdd, adaptersList, displayCommand, type AdapterAddPlan } from './commands/adapter.js'
import { askCommand, formatAdapters, formatAnswer } from './commands/ask.js'
import { cloudLink } from './commands/cloud/link.js'
import { cloudLogin, cloudLogout, cloudWhoami } from './commands/cloud/login.js'
import { cloudPull } from './commands/cloud/pull.js'
import { cloudPush } from './commands/cloud/push.js'
import { cloudStatus } from './commands/cloud/status.js'
import { cloudTokenCreate, cloudTokenList, cloudTokenRevoke, parseExpiry, parseScopes } from './commands/cloud/token.js'
import { configMigrate } from './commands/config.js'
import { graph } from './commands/graph.js'
import { init } from './commands/init.js'
import { open } from './commands/open.js'
import {
  ontology,
  relationshipsFrom,
  relationshipsTo
} from './commands/ontology.js'
import { rebuild } from './commands/rebuild.js'
import { runtimeDown, runtimePlan, runtimeStatus, runtimeUp } from './commands/runtime.js'
import { DEFAULT_SEARCH_LIMIT, search } from './commands/search.js'
import { setup, type StepOutcome } from './commands/setup.js'
import { failureOf, sync, SyncError, type SyncResult } from './commands/sync.js'
import { validate } from './commands/validate.js'
import { watch } from './commands/watch.js'
import { ONTOLOGY_TEMPLATES } from './config/defaults.js'
import { DEFAULT_ASK_RESULTS } from './query/ask.js'
import { describePath } from './query/legacy.js'
import { adaptersStatus } from './query/status.js'
import { confidenceModel, observationConfidence } from './evidence/confidence.js'
import { terminalPrompter } from './install/answers.js'
import { PROVIDERS } from './install/providers.js'
import { openBrowser } from './open/browser.js'
import { allowedOrigin } from './open/server.js'
import type { RecordRef, TargetReport } from './projection/manager.js'
import {
  hasErrors,
  type Diagnostic,
  type Ontology,
  type TypeConstraint
} from './model/index.js'

// Printing lives only in this file. Every layer below returns diagnostics.

const LABEL: Record<Diagnostic['severity'], string> = {
  error: 'ERROR',
  warning: 'WARN '
}

/** Grouped by file, because that is how a developer fixes them (spec §40). */
const printDiagnostics = (diagnostics: Diagnostic[]): void => {
  const groups = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    const key = diagnostic.path ?? '(repository)'
    const group = groups.get(key)
    if (group) group.push(diagnostic)
    else groups.set(key, [diagnostic])
  }

  for (const [path, group] of groups) {
    console.error(`\n${path}`)
    for (const diagnostic of group) {
      console.error(
        `  ${LABEL[diagnostic.severity]} ${diagnostic.code}: ${diagnostic.message}`
      )
    }
  }
}

/** Warnings never fail a run; errors always do (spec §40). */
const report = (diagnostics: Diagnostic[]): void => {
  printDiagnostics(diagnostics)
  if (hasErrors(diagnostics)) process.exitCode = 1
}

const count = (diagnostics: Diagnostic[], code: string): number =>
  diagnostics.filter((d) => d.code === code).length

const describe = (constraint: TypeConstraint): string =>
  constraint === '*' ? '*' : constraint.join(', ')

const pad = (value: string, width: number): string => value.padEnd(width)

const widest = (values: readonly string[]): number =>
  values.reduce((max, value) => Math.max(max, value.length), 0)

/** Shared by both ontology subcommands: load, or report why it could not. */
const requireOntology = async (): Promise<Ontology | null> => {
  const loaded = await ontology()
  if (loaded.ontology === null) {
    report(loaded.diagnostics)
    return null
  }
  console.log(`${loaded.path} (version ${loaded.ontology.version})`)
  return loaded.ontology
}

const printAttributes = (
  attributes: Record<string, { type: string; enum?: (string | number)[] }>
): void => {
  const names = Object.keys(attributes).sort()
  const width = widest(names)
  for (const name of names) {
    const definition = attributes[name]
    if (!definition) continue
    const allowed = definition.enum ? ` (${definition.enum.join(', ')})` : ''
    console.log(`    ${pad(name, width)}  ${definition.type}${allowed}`)
  }
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const program = new Command()

program
  .name('docket')
  .description('Capture and classify project knowledge as Markdown: files are authoritative, indexes are disposable.')
  .version(version)

program
  .command('init')
  .description('Create .docket.yaml, the .docket/ tree and a starting ontology')
  .option('--force', 'overwrite an existing config or ontology')
  .option('--template <name>', `starting ontology: ${Object.keys(ONTOLOGY_TEMPLATES).join(', ')}`, 'sdlc')
  .action(async (options: { force?: boolean; template: string }) => {
    const result = await init({ force: options.force, template: options.template })
    console.log(`Initialized docket in ${result.projectRoot}`)
    for (const path of result.created) console.log(`  created ${path}`)
    for (const path of result.updated) console.log(`  updated ${path}`)
    for (const path of result.skipped) console.log(`  skipped ${path} (exists)`)
  })

const MARK: Record<StepOutcome, string> = {
  done: '✓',
  skipped: '-',
  failed: '✗',
  manual: '!'
}

program
  .command('setup')
  .description('Install the Claude Code plugin and set up docket in this repository')
  .option('--team', 'install the plugin for the repository, so everyone who clones it is offered it')
  .option('-y, --yes', 'take the recommended answer to every question without asking')
  .option('--no-init', 'do not offer to run docket init')
  .option('--global', 'also install the CLI globally (npm install -g) without asking')
  .option('--no-global', 'do not offer to install the CLI globally')
  .action(
    async (options: { team?: boolean; yes?: boolean; init: boolean; global?: boolean }) => {
      const result = await setup({
        team: options.team,
        yes: options.yes,
        init: options.init,
        global: options.global
      })
      console.log(`\ndocket setup in ${result.projectRoot}`)
      const width = widest(result.steps.map((step) => step.name))
      for (const step of result.steps) {
        console.log(`  ${MARK[step.outcome]} ${pad(step.name, width)}  ${step.detail}`)
      }
      if (result.next.length > 0) console.log(`\nNext:\n  ${result.next.join('\n  ')}`)
      if (!result.ok) process.exitCode = 1
    }
  )

program
  .command('watch')
  .description('Watch the canonical files and reconcile continuously')
  .action(async () => {
    const handle = await watch()

    // Ctrl-C must flush and close the projections rather than leave a
    // half-written index behind.
    const stop = () => {
      void handle.close().then(() => process.exit(0))
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })

const collect = (value: string, previous: string[]): string[] => [...previous, value]

/** `3`, or `5 (3 entity, 2 document)` when an instance takes more than one kind. */
const counted = (refs: readonly RecordRef[], inputs: readonly string[]): string => {
  if (inputs.length <= 1 || refs.length === 0) return String(refs.length)
  const kinds = inputs
    .map((kind) => [kind, refs.filter((ref) => ref.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
  return `${refs.length} (${kinds.map(([kind, count]) => `${count} ${kind}`).join(', ')})`
}

/** Why an instance's manifest was not simply its own, current one. */
const manifestNote = (target: TargetReport): string => {
  switch (target.origin) {
    case 'migrated':
      return ' - carried over from the shared manifest'
    case 'adopted':
      return ' - carried over from a renamed instance'
    case 'reconfigured':
      return ' - reset: its endpoint, scope or configuration changed'
    case 'interrupted':
      return ' - reset: an earlier reset or rebuild did not finish'
    case 'created':
    case 'current':
    case 'rebuilt':
      return ''
  }
}

/** One line per adapter instance; any that failed is reported on stderr, and fails the command. */
const reportSync = (result: SyncResult, fresh: boolean): void => {
  for (const target of result.adapters) {
    const failed = target.error !== undefined || target.failed.length > 0
    if (target.error === undefined) {
      const projected = counted(target.upserted, target.inputs)
      console.log(
        fresh
          ? `${failed ? '!' : '✓'} ${target.id}: ${projected} projected from scratch`
          : `${failed ? '!' : '✓'} ${target.id}: ${projected} projected, ${counted(target.removed, target.inputs)} removed, ` +
              `${target.unchanged} unchanged${manifestNote(target)}`
      )
    }
    if (failed) console.error(`✗ ${target.id}: ${failureOf(target)}`)
  }
  if (result.adapters.length === 0) console.log('✓ no adapter is enabled for projection')
  report(result.diagnostics)
}

/** Runs a sync, reporting every instance - including when some failed, after the rest synced. */
const runSync = async (run: () => Promise<SyncResult>, fresh: boolean): Promise<void> => {
  try {
    reportSync(await run(), fresh)
  } catch (cause) {
    if (!(cause instanceof SyncError)) throw cause
    reportSync(cause.result, fresh)
    process.exitCode = 1
  }
}

program
  .command('sync')
  .description('Reconcile the adapter instances with the canonical files')
  .option('--strict', 'treat unresolved references as errors')
  .option('--adapter <id>', 'sync only this adapter instance (repeatable)', collect, [])
  .action(async (options: { strict?: boolean; adapter: string[] }) => {
    await runSync(
      () => sync({ strict: options.strict, adapters: options.adapter.length > 0 ? options.adapter : undefined }),
      false
    )
  })

program
  .command('rebuild')
  .description('Reset adapter instances and reproject them from the canonical files')
  .option('--strict', 'treat unresolved references as errors')
  .option('--adapter <id>', 'rebuild only this adapter instance (repeatable); the others are left as they are', collect, [])
  .action(async (options: { strict?: boolean; adapter: string[] }) => {
    await runSync(
      () => rebuild({ strict: options.strict, adapters: options.adapter.length > 0 ? options.adapter : undefined }),
      true
    )
  })

program
  .command('validate')
  .description('Check the canonical files against the ontology')
  .option('--strict', 'treat unresolved references as errors')
  .action(async (options: { strict?: boolean }) => {
    const result = await validate({ strict: options.strict })
    // Files that share an id are one resource; without an ontology nothing
    // was merged, so count the files.
    const merged = result.ontology !== null
    const resources = merged ? result.entities : result.documents
    const files = result.entities.reduce((n, e) => n + e.paths.length, 0)
    const links = resources.reduce((n, r) => n + r.links.length, 0)
    const dangling = count(result.diagnostics, 'dangling-reference')

    console.log(
      `✓ ${resources.length} resources${merged && files > resources.length ? ` from ${files} files` : ''}`
    )
    console.log(`✓ ${links} relationships`)
    if (dangling > 0) console.log(`⚠ ${dangling} unresolved relationships`)
    report(result.diagnostics)
  })

program
  .command('graph')
  .description('Print every exhibit and link, read from the canonical files: what docket open draws (read-only)')
  .requiredOption('--json', `print the graph as versioned JSON, schema "docket.graph" (docs/graph-json.md)`)
  .option('--root <dir>', 'resolve .docket.yaml from this directory instead of the working one')
  .addHelpText(
    'after',
    '\nExits 0 whenever it prints the graph, with any invalid files reported in its diagnostics.\n' +
      'Exits 1, printing nothing on stdout, when --json is missing, no .docket.yaml is found or --root is not a directory.'
  )
  .showHelpAfterError()
  .action(async (options: { root?: string }) => {
    // A reader gets the diagnostics in the JSON; they never fail the command.
    console.log(JSON.stringify(await graph({ root: options.root }), null, 2))
  })

program
  .command('search')
  .argument('<query...>', 'what to look for')
  .description('Ask every adapter enabled for query, and show the documents each found (docket ask shows their full answers)')
  .option('-n, --limit <count>', 'hits asked of each projection', String(DEFAULT_SEARCH_LIMIT))
  .option('--json', 'print the full result as JSON')
  .action(async (words: string[], options: { limit: string; json?: boolean }) => {
    const limit = Number.parseInt(options.limit, 10)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive whole number, got "${options.limit}"`)
    }
    const result = await search(words.join(' '), { limit })

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      const byId = new Map(result.documents.map((document) => [document.id, document]))
      for (const source of result.sources) {
        console.log(`\n${source.name}`)
        if (source.note) console.log(`  ${source.note.replace(/\n/g, '\n  ')}`)
        if (source.error) console.log(`  unavailable: ${source.error}`)
        else if (source.hits.length === 0) console.log('  no matches')
        for (const hit of source.hits) {
          const score = hit.score === undefined ? '' : `  (${Number(hit.score.toFixed(3))})`
          const found = byId.get(hit.id)
          const confidence = found?.confidence === undefined ? '' : `  confidence ${found.confidence}`
          console.log(`  ${hit.id}${score}  ${found?.path ?? ''}${confidence}`)
          if (hit.detail) console.log(`    ${hit.detail}`)
        }
        for (const path of source.graph?.paths ?? []) console.log(`  path: ${describePath(source.graph?.edges ?? [], path)}`)
      }
      if (result.sources.length === 0) console.log('No configured projection can search.')
    }
    report(result.diagnostics)
  })

program
  .command('ask')
  .argument('<question...>', 'what to ask')
  .description('Ask the adapters enabled for query, through the shared coordinator, and show each answer with its evidence')
  .option('--adapter <id>', 'ask only this adapter instance (repeatable)', collect, [])
  .option('-n, --limit <count>', 'results asked of each adapter', String(DEFAULT_ASK_RESULTS))
  .option('--json', 'print the coordinated answer as JSON: blocks, evidence and diagnostics')
  .option('--synthesis', 'summarize the results with a model (the default, except with --json)')
  .option('--no-synthesis', 'show the results without a summary')
  .option('--timezone <zone>', 'IANA time zone relative times are read in (default: this machine\'s)')
  .action(
    async (
      words: string[],
      options: { adapter: string[]; limit: string; json?: boolean; synthesis?: boolean; timezone?: string }
    ) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive whole number, got "${options.limit}"`)
      }
      // JSON is for programs reading the results; a summary there is asked for, not assumed.
      const synthesis = options.synthesis ?? (options.json ? false : undefined)
      const controller = new AbortController()
      const stop = (): void => controller.abort()
      process.once('SIGINT', stop)
      try {
        const answer = await askCommand(words.join(' '), {
          adapters: options.adapter.length > 0 ? options.adapter : undefined,
          maxResults: limit,
          synthesis,
          timezone: options.timezone,
          signal: controller.signal
        })
        if (options.json) console.log(JSON.stringify(answer, null, 2))
        else console.log(formatAnswer(answer).join('\n'))
        for (const diagnostic of answer.diagnostics) {
          console.error(`${diagnostic.severity === 'error' ? 'ERROR' : diagnostic.severity === 'warning' ? 'WARN ' : 'NOTE '} ${diagnostic.code}: ${diagnostic.message}`)
        }
        if (answer.results.length > 0 && answer.results.every((result) => result.state === 'failed')) process.exitCode = 1
      } finally {
        process.off('SIGINT', stop)
      }
    }
  )

program
  .command('open')
  .description('Browse, search and ask about the knowledge in a web UI')
  .option('-p, --port <port>', 'port to serve on (default: 4380, or any free port when taken)')
  .option('--host <address>', 'interface to listen on; 0.0.0.0 serves every network interface', '127.0.0.1')
  .option('--no-open', 'print the address without opening a browser')
  .option(
    '--allow-origin <origin>',
    'another page on this machine that may use the UI\'s API, such as Wheelhouse at http://127.0.0.1:4310 (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[]
  )
  .option('--init', 'start a docket here first, as docket init does, when this directory has no .docket.yaml')
  .action(async (options: { port?: string; host: string; open: boolean; allowOrigin: string[]; init?: boolean }) => {
    let port: number | undefined
    if (options.port !== undefined) {
      port = Number(options.port)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port must be a port number, got "${options.port}"`)
      }
    }
    const host = options.host.trim()
    if (host === '') throw new Error('--host must be an address to listen on, such as 127.0.0.1 or 0.0.0.0')
    for (const origin of options.allowOrigin) {
      const checked = allowedOrigin(origin)
      if (!checked.ok) throw new Error(`--allow-origin: ${checked.reason}`)
    }
    const handle = await open({ port, host, allowOrigins: options.allowOrigin, init: options.init })
    if (handle.initialized) {
      console.log(`Initialized docket in ${handle.initialized.projectRoot}`)
      for (const path of handle.initialized.created) console.log(`  created ${path}`)
      for (const path of handle.initialized.updated) console.log(`  updated ${path}`)
    }
    const reach =
      handle.host === '127.0.0.1' || handle.host === '::1' || handle.host === 'localhost'
        ? 'this machine only'
        : handle.host === '0.0.0.0' || handle.host === '::'
          ? 'listening on every interface: anyone who can reach this machine can read it'
          : `listening on ${handle.host}`
    console.log(`docket UI for ${handle.resolved.projectRoot}`)
    console.log(`  ${handle.url}  (${reach})`)
    if (handle.allowOrigins.length > 0) console.log(`  also usable from ${handle.allowOrigins.join(', ')}`)
    console.log('Press Ctrl-C to stop.')
    if (options.open) openBrowser(handle.url)

    const stop = () => {
      void handle.close().then(() => process.exit(0))
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })

const runtimeCommand = program
  .command('runtime')
  .description('Explicitly manage the local containers a runtimes entry in .docket.yaml configures')

runtimeCommand
  .command('plan')
  .argument('<id>', 'runtime id from .docket.yaml')
  .description('Validate the runtime and show what up, status and down would run, secrets redacted')
  .action(async (id: string) => {
    const plan = await runtimePlan(id)
    const rows: [string, string][] = [
      ['compose file', plan.composeFile],
      ['project', plan.projectName],
      ['pull policy', plan.pullPolicy],
      ['services', plan.services.length > 0 ? plan.services.join(', ') : '(every service in the file)'],
      ['adapters', plan.adapters.length > 0 ? plan.adapters.join(', ') : '(none reference it)']
    ]
    console.log(`runtime ${plan.runtime} (${plan.provider})`)
    const width = widest(rows.map(([label]) => label))
    for (const [label, value] of rows) console.log(`  ${pad(label, width)}  ${value}`)
    for (const service of plan.resolved) {
      console.log(`\n  ${service.name}`)
      console.log(`    image        ${service.image ?? '(none)'}`)
      if (service.ports.length > 0) console.log(`    ports        ${service.ports.join(', ')}`)
      if (service.volumes.length > 0) console.log(`    volumes      ${service.volumes.join(', ')}`)
      if (service.environment.length > 0) {
        console.log(`    environment  ${service.environment.map((name) => `${name}=<redacted>`).join(', ')}`)
      }
    }
    console.log('\n  operations')
    for (const [name, operation] of Object.entries(plan.operations)) {
      console.log(`    ${name}: ${operation.description}\n      ${operation.command}`)
    }
    for (const problem of plan.problems) console.error(`ERROR ${problem}`)
    if (plan.problems.length > 0) process.exitCode = 1
  })

runtimeCommand
  .command('up')
  .argument('<id>', 'runtime id from .docket.yaml')
  .description('Start the runtime\'s services, pulling images only as its pullPolicy allows')
  .action(async (id: string) => {
    const result = await runtimeUp(id)
    console.log(`✓ runtime ${result.runtime} is up`)
  })

runtimeCommand
  .command('status')
  .argument('<id>', 'runtime id from .docket.yaml')
  .description('Report the state and health of the runtime\'s services, changing nothing')
  .action(async (id: string) => {
    const status = await runtimeStatus(id)
    console.log(`runtime ${status.runtime} (project ${status.projectName})`)
    if (status.services.length === 0) console.log('  no containers')
    const width = widest(status.services.map((service) => service.service))
    for (const service of status.services) {
      const health = service.health ? ` (${service.health})` : ''
      const detail = service.status ? `  ${service.status}` : ''
      console.log(`  ${pad(service.service, width)}  ${service.state}${health}${detail}`)
    }
  })

runtimeCommand
  .command('down')
  .argument('<id>', 'runtime id from .docket.yaml')
  .description('Stop and remove the runtime\'s containers; volumes and their data are kept')
  .option('--destroy-volumes', 'also delete the runtime\'s volumes and all the data in them')
  .action(async (id: string, options: { destroyVolumes?: boolean }) => {
    const result = await runtimeDown(id, { destroyVolumes: options.destroyVolumes === true })
    console.log(
      options.destroyVolumes
        ? `✓ runtime ${result.runtime} is down and its volumes are deleted`
        : `✓ runtime ${result.runtime} is down; its volumes are kept`
    )
  })

/** Everything `docket adapter add` will do, shown before it does any of it. */
const printAddPlan = (plan: AdapterAddPlan): void => {
  const { entry, runtime } = plan.addition
  console.log(`\nPlan: add the ${plan.provider} adapter "${entry.id}" (${entry.module})`)
  console.log(`\n  ${plan.configFile} gains:`)
  console.log(`    ${plan.configYaml.trimEnd().replace(/\n/g, '\n    ')}`)
  if (plan.files.length > 0) {
    console.log('\n  Files')
    for (const file of plan.files) {
      if (file.exists) {
        console.log(`    keep    ${file.path}  (exists; never overwritten)`)
      } else {
        console.log(`    create  ${file.path}  (${file.purpose})`)
        console.log(`      ${file.contents.trimEnd().replace(/\n/g, '\n      ')}`)
      }
    }
  }
  if (plan.env.length > 0) {
    console.log('\n  Environment variables - set them yourself; only their names are written')
    const width = widest(plan.env.map((variable) => variable.name))
    for (const variable of plan.env) {
      const marks = [variable.secret ? 'secret' : '', variable.required ? '' : 'optional'].filter(Boolean)
      console.log(`    ${pad(variable.name, width)}  ${variable.purpose}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`)
    }
  }
  if (plan.module !== undefined) {
    console.log('\n  Adapter package')
    console.log(
      `    ${plan.module.name}  ` +
        (plan.module.installed
          ? 'installed in the project'
          : 'not installed; docket does not bundle it and it is not on npm, so add it to the project yourself')
    )
  }
  if (plan.prerequisites.length > 0) {
    console.log('\n  Install yourself - docket never installs these')
    for (const line of plan.prerequisites) console.log(`    ${line}`)
  }
  if (plan.driver !== undefined) {
    const { driver } = plan
    console.log('\n  Package')
    console.log(
      `    ${driver.spec}  ` +
        (driver.installed
          ? 'already installed'
          : driver.command
            ? `not installed; installed only if you agree: ${displayCommand(driver.command)}`
            : `not installed, and there is no package.json in ${plan.projectRoot} to install it into`)
    )
  }
  if (runtime !== undefined) {
    console.log(`\n  Nothing is pulled or started now: \`docket runtime up ${runtime.id}\` does that when you run it.`)
  }
  for (const note of plan.notes) console.log(`\n  Note: ${note}`)
}

const OUTCOME = (ok: boolean): string => (ok ? '✓' : '✗')

const adapterCommand = program
  .command('adapter')
  .description('Set up an adapter instance in .docket.yaml')

adapterCommand
  .command('add')
  .argument('<provider>', `what to set up: ${PROVIDERS.map((provider) => provider.name).join(', ')}`)
  .description('Ask what an adapter needs, show the resolved plan, and apply it once confirmed')
  .option('--id <id>', 'adapter instance id')
  .option('--roles <roles>', 'projection,query (default), query or projection')
  .option('--mode <mode>', 'neo4j: external (default) or local; mem0: platform (default) or server')
  .option('--url <url>', 'the endpoint to connect to (neo4j external, mem0 server, cognee)')
  .option('--username <name>', 'neo4j: username (default neo4j)')
  .option('--database <name>', 'neo4j: database (default: the server\'s)')
  .option('--password-env <name>', 'neo4j: environment variable holding the password ("none": no auth)')
  .option('--api-key-env <name>', 'mem0, cognee: environment variable holding the API key (default MEM0_API_KEY, COGNEE_API_KEY)')
  .option('--scope <scope>', 'neo4j scope, or mem0 agent id (default: one unique to the checkout)')
  .option('--output <dir>', 'jsonl: directory to write to')
  .option('--file <path>', 'memvid: the .mv2 file (default: in the adapter\'s state directory)')
  .option('--namespace <name>', 'memvid: namespace for this project\'s frames')
  .option('--palace <dir>', 'mempalace: palace directory (default: in the adapter\'s state directory)')
  .option('--wing <name>', 'mempalace: wing to file drawers under')
  .option('--dataset <name>', 'cognee: dataset to file into (default: one unique to the checkout)')
  .addOption(new Option('--embedding-model <model>', 'mempalace: embedding model').choices(['minilm', 'embeddinggemma']))
  .option('--command <command>', 'memvid: the CLI (default memvid); mempalace: the MCP server (default mempalace-mcp)')
  .option('--image <ref>', 'neo4j local: the image to run (default: read from --image-env when up runs)')
  .option('--image-env <name>', 'neo4j local: environment variable holding the image (default DOCKET_NEO4J_IMAGE)')
  .option('--port <port>', 'neo4j local: Bolt port on 127.0.0.1 (default 17687)')
  .option('--runtime-id <id>', 'neo4j local: runtime group id (default <id>-dev, numbered if taken)')
  .option('--compose-file <path>', 'neo4j local: Compose file to create, relative to .docket.yaml')
  .option('--project-name <name>', 'neo4j local: Compose project name')
  .addOption(new Option('--pull-policy <policy>', 'neo4j local: when runtime up may pull').choices(['never', 'missing', 'always']))
  .option('-y, --yes', 'ask nothing: take the options and defaults, and apply the plan')
  .option('--dry-run', 'show the plan and change nothing')
  .option('--install', 'install the driver package with the project\'s package manager without asking')
  .option('--no-install', 'never offer to install the driver package')
  .option('--plan-runtime', 'run `docket runtime plan` afterwards (local containers)')
  .option('--check', 'open the adapter afterwards and report its status')
  .action(async (provider: string, options: Record<string, string | boolean | undefined>) => {
    const value = (name: string): string | undefined => {
      const given = options[name]
      return typeof given === 'string' ? given : undefined
    }
    const flags = [
      'id', 'roles', 'mode', 'url', 'username', 'database', 'passwordEnv', 'apiKeyEnv', 'scope', 'output',
      'file', 'namespace', 'palace', 'wing', 'dataset', 'embeddingModel', 'command',
      'image', 'imageEnv', 'port', 'runtimeId', 'composeFile', 'projectName', 'pullPolicy'
    ]
    const values = Object.fromEntries(
      flags.map((name) => [`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value(name)])
    )
    // --install defined before --no-install leaves it unset unless one is given.
    const install = typeof options.install === 'boolean' ? options.install : undefined
    const result = await adapterAdd(provider, {
      values,
      yes: options.yes === true,
      dryRun: options.dryRun === true,
      prompter: terminalPrompter(),
      show: printAddPlan,
      install,
      planRuntime: options.planRuntime === true ? true : undefined,
      check: options.check === true ? true : undefined
    })
    const { plan } = result
    if (result.status === 'preview') {
      console.log(`\nOnce applied, next:\n  ${plan.next.join('\n  ')}`)
      console.log('\nDry run: nothing was changed.')
      return
    }
    if (result.status === 'declined') {
      console.log('\nNothing was changed.')
      return
    }
    console.log(`\n✓ added adapter "${plan.addition.entry.id}" to ${plan.configFile}`)
    for (const path of result.created) console.log(`✓ created ${path}`)
    for (const path of result.kept) console.log(`- kept ${path} (exists)`)
    if (result.install) {
      console.log(`${OUTCOME(result.install.ok)} ${result.install.ok ? `installed: ${result.install.value}` : result.install.error}`)
    }
    if (result.runtimePlan) {
      if (result.runtimePlan.ok) {
        const runtimePlan = result.runtimePlan.value
        console.log(`${OUTCOME(runtimePlan.problems.length === 0)} docket runtime plan ${runtimePlan.runtime}`)
        for (const problem of runtimePlan.problems) console.log(`    ${problem}`)
      } else {
        console.log(`✗ docket runtime plan: ${result.runtimePlan.error}`)
      }
    }
    if (result.check) {
      console.log(
        result.check.ok
          ? `${OUTCOME(result.check.value.state !== 'unavailable')} status: ${result.check.value.state} - ${result.check.value.message}`
          : `✗ status check: ${result.check.error}`
      )
    }
    if (plan.next.length > 0) console.log(`\nNext:\n  ${plan.next.join('\n  ')}`)
    const failed = [result.install, result.runtimePlan, result.check].some((outcome) => outcome?.ok === false)
    if (failed) process.exitCode = 1
  })

const adaptersCommand = program
  .command('adapters')
  .description('Inspect the adapter instances .docket.yaml configures')

adaptersCommand
  .command('list')
  .description('List the configured adapter instances and whether each can load, connecting to nothing')
  .option('--json', 'print the result as JSON')
  .action(async (options: { json?: boolean }) => {
    const result = await adaptersList()
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(result.configFile)
    if (result.adapters.length === 0) console.log('  no adapters')
    const width = widest(result.adapters.map((adapter) => adapter.id))
    for (const adapter of result.adapters) {
      const runtime = adapter.runtime ? `  runtime ${adapter.runtime}` : ''
      const source = adapter.source ? ` (${adapter.source})` : ''
      console.log(`  ${pad(adapter.id, width)}  ${adapter.module}${source}  [${adapter.roles.join(', ')}]${runtime}`)
      if (adapter.problem) console.log(`  ${pad('', width)}  ! ${adapter.problem}`)
    }
    console.log('\n`docket adapter add <provider>` sets up:')
    const providerWidth = widest(result.providers.map((provider) => provider.name))
    for (const provider of result.providers) console.log(`  ${pad(provider.name, providerWidth)}  ${provider.summary}`)
    if (result.adapters.some((adapter) => adapter.problem)) process.exitCode = 1
  })

adaptersCommand
  .command('status')
  .description('Connect to each adapter instance and report its health and how far its index lags the files; starts nothing')
  .option('--json', 'print the status as JSON')
  .action(async (options: { json?: boolean }) => {
    const response = await adaptersStatus(process.cwd())
    if (options.json) console.log(JSON.stringify(response, null, 2))
    else console.log(formatAdapters(response).join('\n'))
    for (const diagnostic of response.diagnostics) {
      console.error(`${diagnostic.severity === 'error' ? 'ERROR' : 'WARN '} ${diagnostic.code}: ${diagnostic.message}`)
    }
    if (response.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) process.exitCode = 1
  })

const configCommand = program
  .command('config')
  .description('Upgrade .docket.yaml')

configCommand
  .command('migrate')
  .description('Rewrite a version 1 .docket.yaml as version 2; version 1 keeps working without it')
  .option('--dry-run', 'print the version 2 file and write nothing')
  .option('--write', 'rewrite the file without asking; the original is kept as a backup')
  .action(async (options: { dryRun?: boolean; write?: boolean }) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    const result = await configMigrate({
      dryRun: options.dryRun,
      write: options.write,
      confirm: interactive
        ? async (question, text) => {
            console.log(text)
            const prompt = createInterface({ input: process.stdin, output: process.stdout })
            try {
              return (await prompt.question(`${question} [y/N] `)).trim().toLowerCase().startsWith('y')
            } finally {
              prompt.close()
            }
          }
        : undefined
    })
    switch (result.status) {
      case 'current':
        console.error(`${result.file} is already version 2; nothing to migrate.`)
        break
      case 'preview':
        // The file alone on stdout, so it can be redirected.
        process.stdout.write(result.text)
        break
      case 'declined':
        console.error(`Left ${result.file} unchanged.`)
        break
      case 'written':
        console.log(`✓ ${result.file} is now version 2; the original is kept at ${result.backup}`)
        break
    }
  })

const ontologyCommand = program
  .command('ontology')
  .description('Inspect the resource types and relationships (spec §41)')

ontologyCommand
  .command('list')
  .description('List every registered resource type and relationship')
  .action(async () => {
    const registry = await requireOntology()
    if (!registry) return

    const types = Object.keys(registry.resourceTypes).sort()
    console.log(`\nResource types (${types.length})`)
    const typeWidth = widest(types)
    for (const name of types) {
      const description = registry.resourceTypes[name]?.description?.trim() ?? ''
      console.log(`  ${pad(name, typeWidth)}  ${description}`)
    }

    const relationships = Object.keys(registry.relationships).sort()
    console.log(`\nRelationships (${relationships.length})`)
    const relWidth = widest(relationships)
    for (const name of relationships) {
      const definition = registry.relationships[name]
      if (!definition) continue
      console.log(
        `  ${pad(name, relWidth)}  ${describe(definition.from)} → ${describe(definition.to)}`
      )
    }

    const model = confidenceModel(registry)
    const sources = Object.keys(model.sources).sort()
    console.log(`\nEvidence sources (${sources.length})`)
    const sourceWidth = widest(sources)
    for (const name of sources) {
      const source = model.sources[name]
      if (!source) continue
      const needs = [
        ...(source.requires ?? []),
        ...(source.requiresAny?.length ? [`one of ${source.requiresAny.join('/')}`] : [])
      ]
      console.log(
        `  ${pad(name, sourceWidth)}  ${source.confidence}${needs.length ? `  needs ${needs.join(', ')}` : ''}`
      )
    }
    console.log(`  (no evidence: ${model.unevidenced})`)
  })

ontologyCommand
  .command('show')
  .argument('<type>', 'resource type to describe')
  .description('Show one resource type, its attributes and its relationships')
  .action(async (type: string) => {
    const registry = await requireOntology()
    if (!registry) return

    const definition = registry.resourceTypes[type]
    if (!definition) {
      console.error(`\nResource type "${type}" is not registered.`)
      process.exitCode = 1
      return
    }

    console.log(`\n${type}`)
    if (definition.description) console.log(`  ${definition.description.trim()}`)

    console.log('\n  attributes')
    printAttributes(definition.attributes ?? {})

    console.log('\n  relationships from')
    for (const relationship of relationshipsFrom(registry, type)) {
      console.log(`    ${relationship.name} → ${describe(relationship.to)}`)
    }

    console.log('\n  relationships to')
    for (const relationship of relationshipsTo(registry, type)) {
      console.log(`    ${relationship.name} ← ${describe(relationship.from)}`)
    }

    const extraction = definition.extraction?.instructions
    if (extraction) console.log(`\n  extraction\n    ${extraction.trim()}`)

    // What one observation of this type is worth, by where it was seen. A
    // value the type sets itself is marked, so its rules stand out.
    const model = confidenceModel(registry)
    const rules = model.resourceTypes[type] ?? {}
    const sources = Object.keys(model.sources).sort()
    const sourceWidth = widest(sources)
    console.log('\n  confidence by evidence source')
    for (const source of sources) {
      const value = observationConfidence(model, { kind: 'resource', type }, source)
      console.log(`    ${pad(source, sourceWidth)}  ${value}${source in rules ? '  (this type)' : ''}`)
    }
  })

const cloudCommand = program
  .command('cloud')
  .description('Share this project\'s knowledge with a Docket Cloud workspace; nothing here runs unless you ask')

cloudCommand
  .command('login')
  .description('Sign in to the workspace this project is linked to, with a code in the browser; run `docket cloud link <org>/<workspace>` first')
  .option('--url <url>', 'the cloud; it must be the one the project is linked to')
  .action(async (options: { url?: string }) => {
    const result = await cloudLogin({
      url: options.url,
      io: {
        show: ({ url, userCode }) => console.log(`Enter the code ${userCode} at:\n  ${url}`),
        openBrowser,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      }
    })
    console.log(`✓ signed in to ${result.workspace}`)
    console.log(result.location === 'keychain' ? '  kept in the keychain' : `  kept in ${result.file} (readable only by you)`)
  })

cloudCommand
  .command('logout')
  .description('Forget the sign-in for the linked workspace, and revoke it at the cloud')
  .action(async () => {
    const result = await cloudLogout()
    if (!result.removed) {
      console.log(`- not signed in to ${result.workspace}`)
      return
    }
    console.log(`✓ signed out of ${result.workspace}`)
    if (!result.revoked) console.log('  the cloud could not be asked to revoke the session; it expires on its own')
  })

cloudCommand
  .command('whoami')
  .description('Show who the linked workspace\'s sign-in acts as')
  .action(async () => {
    const { workspace, identity } = await cloudWhoami()
    console.log(`${identity.login} (${identity.role}) in ${workspace}`)
    console.log(`  scopes   ${identity.scopes.join(' ')}`)
    console.log(`  ${identity.token.kind === 'api' ? 'API token' : 'session'} expires ${identity.token.expiresAt}`)
  })

cloudCommand
  .command('link')
  .argument('<org/workspace>', 'the workspace, as its cloud URL names it: acme/platform')
  .description('Link this project to a cloud workspace: adds a query-only cloud adapter to .docket.yaml')
  .option('--url <url>', 'the cloud (default https://docket.chrisjowen.net)')
  .option('--token-env <name>', 'for CI: an environment variable holding an API token, used instead of a sign-in')
  .action(async (target: string, options: { url?: string; tokenEnv?: string }) => {
    const result = await cloudLink(target, options)
    const { url, workspace } = result.entry.config as { url: string; workspace: string }
    console.log(`✓ linked to ${workspace} on ${url}: added adapter "${result.entry.id}" to ${result.configFile}`)
    console.log('  docket search, ask and open now include its answers; offline, it is reported unavailable')
    console.log(`\nNext:\n  ${options.tokenEnv ? `set ${options.tokenEnv} to a token from \`docket cloud token create\`` : 'docket cloud login'}`)
  })

cloudCommand
  .command('push')
  .description('Upload the canonical files that changed to the linked workspace, and propose a differing ontology as a draft')
  .option('--dry-run', 'have the cloud check the files and report, changing nothing')
  .action(async (options: { dryRun?: boolean }) => {
    const result = await cloudPush({ dryRun: options.dryRun })
    const would = result.dryRun ? 'would upload' : 'uploaded'
    console.log(`${result.ok ? '✓' : '✗'} ${result.workspace} (checkout ${result.checkout})`)
    console.log(`  ${would} ${result.uploaded.length}, ${result.dryRun ? 'would retire' : 'retired'} ${result.removed.length}, ${result.unchanged} unchanged`)
    for (const path of result.uploaded) console.log(`    + ${path}`)
    for (const path of result.removed) console.log(`    - ${path}`)
    if (result.notStored.length > 0) console.log(`  ${result.dryRun ? 'would not store' : 'not stored'} ${result.notStored.length}`)
    for (const path of result.notStored) console.log(`    ! ${path}`)
    switch (result.ontology.state) {
      case 'same':
        console.log(`  ontology matches the published version ${result.ontology.version}`)
        break
      case 'differs':
        console.log(`  ontology differs from the published version ${result.ontology.version}; a push would propose it as a draft`)
        break
      case 'proposed':
        console.log(
          `  ontology differs from the published version ${result.ontology.version}: proposed as draft ${result.ontology.proposal.draftId} ` +
            `(${result.ontology.proposal.classification}); an admin publishes it in the web UI`
        )
        break
      case 'absent':
        console.log('  no local ontology file to compare')
        break
    }
    printDiagnostics(result.diagnostics as Diagnostic[])
    if (!result.ok) {
      console.error(
        result.dryRun
          ? '\nThe cloud would refuse the push. Fix the errors above and push again.'
          : `\nThe cloud refused the push: ${result.uploaded.length + result.removed.length > 0 ? 'only the changes listed above were stored' : 'nothing was stored'}. Fix the errors above and push again.`
      )
      process.exitCode = 1
    }
  })

cloudCommand
  .command('pull')
  .description('Write the published ontology here, and with --resources the documents written in the cloud, for an offline copy')
  .option('--ontology', 'write the published ontology to the ontology file (the default)')
  .option('--resources', 'write the cloud-origin documents under the source root; files you have are never overwritten')
  .action(async (options: { ontology?: boolean; resources?: boolean }) => {
    const result = await cloudPull(options)
    console.log(result.workspace)
    if (result.ontology) {
      console.log(
        result.ontology.changed
          ? `✓ wrote version ${result.ontology.version} of the ontology to ${result.ontology.path}`
          : `✓ ${result.ontology.path} is already version ${result.ontology.version}`
      )
    }
    if (result.resources) {
      const { written, unchanged, kept, refused } = result.resources
      console.log(`✓ wrote ${written.length} documents, ${unchanged.length} already here`)
      for (const path of written) console.log(`    + ${path}`)
      for (const path of kept) console.log(`  ! kept ${path}: yours differs from the cloud's`)
      for (const path of refused) console.log(`  ! skipped ${path}: outside the source root`)
    }
  })

cloudCommand
  .command('status')
  .description('Show the link, the sign-in, the ontology against the cloud\'s, and what a push would send')
  .action(async () => {
    const status = await cloudStatus()
    if (status.link === undefined) {
      console.log(`${status.projectRoot} is not linked to a cloud workspace. \`docket cloud link <org>/<workspace>\` links it.`)
      return
    }
    console.log(`linked    ${status.link.workspace} on ${status.link.url} (adapter "${status.link.adapter}")`)
    const session = status.session
    console.log(
      `session   ${
        session?.kind === 'token-env'
          ? `the API token in ${session.variable}`
          : session?.kind === 'session'
            ? `signed in${session.scope ? ` (${session.scope})` : ''}`
            : 'signed out: `docket cloud login` signs in'
      }`
    )
    const { ontology, pending } = status
    if (ontology?.ok) {
      console.log(`ontology  ${ontology.same ? 'matches' : ontology.local ? 'differs from' : 'missing here; the cloud has'} published version ${ontology.version}`)
    } else if (ontology) console.log(`ontology  unknown: ${ontology.error}`)
    if (pending?.ok) {
      console.log(
        pending.upload + pending.remove === 0
          ? 'pending   nothing to push'
          : `pending   ${pending.upload} to upload, ${pending.remove} to retire: \`docket cloud push\` sends them`
      )
    } else if (pending) console.log(`pending   unknown: ${pending.error}`)
  })

const tokenCommand = cloudCommand.command('token').description('Manage API tokens for CI and other headless agents')

tokenCommand
  .command('create')
  .description('Create an API token for the linked workspace; it is shown once')
  .requiredOption('--scopes <scopes>', 'comma-separated: docket:read, docket:write, ontology:read, ontology:propose', collect, [])
  .option('--expires <days>', 'how long it lives, 1d to 90d', '30d')
  .option('--description <text>', 'what it is for')
  .action(async (options: { scopes: string[]; expires: string; description?: string }) => {
    const { workspace, token } = await cloudTokenCreate({
      scopes: parseScopes(options.scopes),
      days: parseExpiry(options.expires),
      description: options.description
    })
    console.log(`✓ created ${token.id} for ${workspace}, expiring ${token.expiresAt}`)
    console.log(`  scopes  ${token.scopes.join(' ')}`)
    console.log('\nThe token - shown only now; keep it in your CI\'s secrets:')
    console.log(`  ${token.token}`)
  })

tokenCommand
  .command('list')
  .description('List the API tokens for the linked workspace')
  .action(async () => {
    const { workspace, tokens } = await cloudTokenList()
    console.log(workspace)
    if (tokens.length === 0) console.log('  no tokens')
    const width = widest(tokens.map((token) => token.id))
    for (const token of tokens) {
      const about = token.description ? `  ${token.description}` : ''
      console.log(`  ${pad(token.id, width)}  ${token.prefix}…  ${token.status}  expires ${token.expiresAt}  ${token.scopes.join(' ')}${about}`)
    }
  })

tokenCommand
  .command('revoke')
  .argument('<id>', 'the token id, tok_…, from `docket cloud token list`')
  .description('Revoke an API token; the next call with it fails')
  .action(async (id: string) => {
    const result = await cloudTokenRevoke(id)
    console.log(`✓ revoked ${result.id} in ${result.workspace}`)
  })

/**
 * An error as one line, and for several adapters failing at once each one's
 * own cause beneath it - the part that says what to install or set.
 */
const describeFailure = (cause: unknown, indent = ''): string => {
  const line = `${indent}${cause instanceof Error ? cause.message : String(cause)}`
  if (!(cause instanceof AggregateError)) return line
  return [line, ...cause.errors.map((inner: unknown) => describeFailure(inner, `${indent}  `))].join('\n')
}

try {
  await program.parseAsync(process.argv)
} catch (cause) {
  console.error(describeFailure(cause))
  process.exitCode = 1
}
