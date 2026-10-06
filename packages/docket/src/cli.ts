#!/usr/bin/env node
import { Command } from 'commander'
import { init } from './commands/init.js'
import {
  ontology,
  relationshipsFrom,
  relationshipsTo
} from './commands/ontology.js'
import { rebuild } from './commands/rebuild.js'
import { DEFAULT_SEARCH_LIMIT, search } from './commands/search.js'
import { sync } from './commands/sync.js'
import { validate } from './commands/validate.js'
import { watch } from './commands/watch.js'
import { confidenceModel, observationConfidence } from './evidence/confidence.js'
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

program
  .command('sync')
  .description('Reconcile the projections with the canonical files')
  .option('--strict', 'treat unresolved references as errors')
  .action(async (options: { strict?: boolean }) => {
    const result = await sync({ strict: options.strict })
    console.log(
      `✓ ${result.upserted.length} projected, ${result.removed.length} removed, ` +
        `${result.unchanged} unchanged`
    )
    report(result.diagnostics)
  })

program
  .command('rebuild')
  .description('Drop every projection and reproject from the canonical files')
  .option('--strict', 'treat unresolved references as errors')
  .action(async (options: { strict?: boolean }) => {
    const result = await rebuild({ strict: options.strict })
    console.log(`✓ ${result.upserted.length} projected from scratch`)
    report(result.diagnostics)
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

try {
  await program.parseAsync(process.argv)
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
}
