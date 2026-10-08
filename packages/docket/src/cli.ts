#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'

import { Command } from 'commander'
import { configMigrate } from './commands/config.js'
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
import { confidenceModel, observationConfidence } from './evidence/confidence.js'
import { openBrowser } from './open/browser.js'
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

const program = new Command()

program
  .name('docket')
  .description('Capture and classify project knowledge as Markdown: files are authoritative, indexes are disposable.')

program
  .command('init')
  .description('Create .docket.yaml, the .docket/ tree and a starting ontology')
  .option('--force', 'overwrite an existing config or ontology')
  .action(async (options: { force?: boolean }) => {
    const result = await init({ force: options.force })
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
  .option('-a, --adapter <id>', 'sync only this adapter instance (repeatable)', collect, [])
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
  .option('-a, --adapter <id>', 'rebuild only this adapter instance (repeatable); the others are left as they are', collect, [])
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
  .command('search')
  .argument('<query...>', 'what to look for')
  .description('Ask every searchable projection, and show what each found')
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
      }
      if (result.sources.length === 0) console.log('No configured projection can search.')
    }
    report(result.diagnostics)
  })

program
  .command('open')
  .description('Browse, search and ask about the knowledge in a web UI')
  .option('-p, --port <port>', 'port to serve on (default: 4380, or any free port when taken)')
  .option('--no-open', 'print the address without opening a browser')
  .action(async (options: { port?: string; open: boolean }) => {
    let port: number | undefined
    if (options.port !== undefined) {
      port = Number(options.port)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port must be a port number, got "${options.port}"`)
      }
    }
    const handle = await open({ port })
    console.log(`docket UI for ${handle.resolved.projectRoot}`)
    console.log(`  ${handle.url}  (listening on all interfaces)`)
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
