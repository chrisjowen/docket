import { Document, isMap, isSeq, parse, parseDocument, YAMLMap, YAMLSeq } from 'yaml'
import { z } from 'zod'

import { DEFAULT_ADAPTERS, memoryConfigSchema, type AdapterInstanceConfig } from '../config/config.js'
import type { DockerComposeRuntimeConfig } from '../runtime/config.js'

/** What `docket adapter add` puts in `.docket.yaml`: one adapter instance, and the runtime group it uses if any. */
export interface ConfigAddition {
  entry: Pick<AdapterInstanceConfig, 'id' | 'module' | 'roles' | 'runtime'> & { config: Record<string, unknown> }
  runtime?: { id: string; config: DockerComposeRuntimeConfig } | undefined
}

/** The entry as plain YAML, the way the instance is written: envelope first, `config` last. */
const entryValue = ({ entry }: ConfigAddition): Record<string, unknown> => ({
  id: entry.id,
  module: entry.module,
  roles: entry.roles,
  ...(entry.runtime === undefined ? {} : { runtime: entry.runtime }),
  config: entry.config
})

/** Flow lists stay on one line, and long values are never folded. */
const FORMAT = { flowCollectionPadding: false, lineWidth: 0 } as const

/** The instance as a node of `document`, roles on one line. */
const entryNode = (document: Document, addition: ConfigAddition): YAMLMap => {
  const node = document.createNode(entryValue(addition)) as YAMLMap
  const roles: unknown = node.get('roles', true)
  if (isSeq(roles)) roles.flow = true
  return node
}

/** The runtime group as a node of `document`, services on one line. */
const runtimeNode = (document: Document, runtime: NonNullable<ConfigAddition['runtime']>): YAMLMap => {
  const node = document.createNode(runtime.config) as YAMLMap
  const services: unknown = node.get('services', true)
  if (isSeq(services)) services.flow = true
  return node
}

/** The lines the addition adds, for showing in a plan. */
export const additionYaml = (addition: ConfigAddition): string => {
  const document = new Document({})
  const root = document.contents as YAMLMap
  const adapters = new YAMLSeq()
  adapters.items.push(entryNode(document, addition))
  root.set('adapters', adapters)
  if (addition.runtime !== undefined) {
    const runtimes = new YAMLMap()
    runtimes.set(addition.runtime.id, runtimeNode(document, addition.runtime))
    root.set('runtimes', runtimes)
  }
  return document.toString(FORMAT)
}

/**
 * The `yaml` parser hangs every comment after a top-level section's last item
 * on that section, and writes them all back at the section's indent. Comment
 * lines that were at the top level in `text` go back to the top level: before
 * the next key, or at the end of the document.
 */
const keepTopLevelComments = (document: Document, root: YAMLMap<unknown, unknown>, text: string): void => {
  root.items.forEach((pair, at) => {
    const value = pair.value as { comment?: string | null; range?: [number, number, number] } | null
    const key = pair.key as { range?: [number, number, number] } | null
    if (!isMap(value) && !isSeq(value)) return
    if (!value.comment || !value.range || !key?.range) return
    const keyColumn = key.range[0] - (text.lastIndexOf('\n', key.range[0] - 1) + 1)
    const trailing = text.slice(value.range[1], value.range[2]).split('\n')
    const first = trailing.findIndex((line) => line.trimStart().startsWith('#'))
    const lines = trailing.slice(first)
    while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
    const commentLines = value.comment.split('\n')
    if (first < 0 || lines.length !== commentLines.length) return
    const outer = lines.findIndex((line) => line.trimStart().startsWith('#') && line.length - line.trimStart().length <= keyColumn)
    if (outer < 0) return
    const inner = commentLines.slice(0, outer)
    while (inner.length > 0 && inner.at(-1)!.trim() === '') inner.pop()
    value.comment = inner.length > 0 ? inner.join('\n') : null
    const moved = commentLines.slice(outer).join('\n')
    const next = root.items[at + 1]?.key as { commentBefore?: string | null; spaceBefore?: boolean } | undefined
    if (next !== undefined && typeof next === 'object' && next !== null) {
      next.commentBefore = next.commentBefore ? `${moved}\n${next.commentBefore}` : moved
      next.spaceBefore = true
    } else {
      document.comment = document.comment ? `${moved}\n${document.comment}` : moved
    }
  })
}

/**
 * Adds an adapter instance - and its runtime group - to a version 2
 * `.docket.yaml`, keeping every existing entry, section and comment. A file
 * without `adapters` has the default local adapter written out first, so
 * adding one never takes away the one it already had. The result must load,
 * and must hold exactly what was there plus the addition.
 */
export const addToConfigText = (text: string, addition: ConfigAddition, file = '.docket.yaml'): string => {
  const document = parseDocument(text)
  if (document.errors.length > 0) throw new Error(`Invalid ${file}: ${document.errors[0]!.message}`)
  const raw: unknown = document.toJS()
  if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 2) {
    throw new Error(`${file} is not version 2; only a version 2 file has adapters to add to.`)
  }
  const before = memoryConfigSchema.safeParse(raw)
  if (!before.success) throw new Error(`Invalid ${file}; fix it before adding an adapter:\n${z.prettifyError(before.error)}`)
  if (before.data.adapters.some((adapter) => adapter.id === addition.entry.id)) {
    throw new Error(`${file} already has an adapter "${addition.entry.id}".`)
  }

  if (!isMap(document.contents)) throw new Error(`Invalid ${file}: expected a mapping at the top level.`)
  const root = document.contents as YAMLMap<unknown, unknown>
  keepTopLevelComments(document, root, text)

  const adapters: unknown = root.get('adapters', true)
  const sequence = isSeq(adapters) ? adapters : (document.createNode(DEFAULT_ADAPTERS) as YAMLSeq)
  if (sequence !== adapters) root.set('adapters', sequence)
  sequence.flow = false
  sequence.items.push(entryNode(document, addition))

  if (addition.runtime !== undefined) {
    const runtimes: unknown = root.get('runtimes', true)
    const map = isMap(runtimes) ? runtimes : new YAMLMap()
    if (map !== runtimes) root.set('runtimes', map)
    map.flow = false
    if (map.has(addition.runtime.id)) throw new Error(`${file} already has a runtime "${addition.runtime.id}".`)
    map.set(addition.runtime.id, runtimeNode(document, addition.runtime))
  }

  const written = document.toString(FORMAT)
  const after = memoryConfigSchema.safeParse(parse(written))
  if (!after.success) {
    throw new Error(`Adding "${addition.entry.id}" would leave ${file} invalid:\n${z.prettifyError(after.error)}`)
  }
  const added = after.data.adapters.find((adapter) => adapter.id === addition.entry.id)
  if (after.data.adapters.length !== before.data.adapters.length + 1 || added === undefined) {
    throw new Error(`Could not add "${addition.entry.id}" to ${file}; it is left unchanged. Please report this.`)
  }
  return written
}
