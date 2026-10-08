import { stableStringify } from '@docket/adapter-kit'
import { isMap, isScalar, isSeq, Pair, parse, parseDocument, Scalar, YAMLMap, YAMLSeq, type Node } from 'yaml'
import { z } from 'zod'

import {
  adapterFromProjection,
  fromV1Config,
  memoryConfigSchema,
  projectionInstanceIds,
  v1ConfigSchema
} from './config.js'

/** What migrating one `.docket.yaml` gives. */
export type ConfigMigration =
  | { version: 2 }
  | {
      version: 1
      /** The same file as version 2. */
      text: string
    }

/** Moves the comments and spacing around `from` onto `to`, so a user's notes stay where they were. */
const carryComments = (from: Node, to: Node): void => {
  to.commentBefore = from.commentBefore
  to.comment = from.comment
  to.spaceBefore = from.spaceBefore
  from.commentBefore = from.comment = undefined
  from.spaceBefore = false
}

const keyIs = (pair: Pair, name: string): boolean => isScalar(pair.key) && pair.key.value === name

/**
 * Rewrites a version 1 `.docket.yaml` as version 2 (docs/adapter-spec.md §5,
 * §15 step 3). Only `version` and `projections` change: each projection
 * becomes an adapter instance with the id and module it already loaded as,
 * its `runtime` moved up and every other field kept under `config` as
 * written. Every other section, and every comment, stays as it was. The
 * result is checked to load as exactly the configuration the original does.
 */
export const migrateConfigText = (text: string, file = '.docket.yaml'): ConfigMigration => {
  const document = parseDocument(text)
  if (document.errors.length > 0) throw new Error(`Invalid ${file}: ${document.errors[0]!.message}`)

  const raw: unknown = document.toJS()
  const version = typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined
  if (version === 2) return { version: 2 }
  if (version !== 1) throw new Error(`Invalid ${file}: version must be 1 or 2`)

  const parsed = v1ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid ${file}; fix it before migrating:\n${z.prettifyError(parsed.error)}`)
  }
  const v1 = parsed.data
  const root = document.contents as YAMLMap<unknown, unknown>

  const versionPair = root.items.find((pair) => keyIs(pair, 'version'))!
  if (isScalar(versionPair.value)) versionPair.value.value = 2
  else versionPair.value = new Scalar(2)

  const ids = projectionInstanceIds(v1.projections)
  const instance = (index: number, body: YAMLMap | undefined): YAMLMap => {
    const { config, ...envelope } = adapterFromProjection(v1.projections[index]!, ids[index]!)
    const node = document.createNode(envelope) as YAMLMap
    const roles: unknown = node.get('roles', true)
    if (isSeq(roles)) roles.flow = true
    if (body === undefined) {
      if (Object.keys(config as object).length > 0) node.set('config', document.createNode(config))
      return node
    }
    // The projection's own fields, as written - comments, quoting and all -
    // less the two v2 moves out of it.
    carryComments(body, node)
    for (const name of ['type', 'runtime']) {
      const at = body.items.findIndex((pair) => keyIs(pair, name))
      if (at < 0) continue
      const [removed] = body.items.splice(at, 1)
      const note = isScalar(removed!.key) ? removed!.key.commentBefore : undefined
      if (note) node.commentBefore = node.commentBefore ? `${node.commentBefore}\n${note}` : note
    }
    if (body.items.length > 0) node.items.push(new Pair(new Scalar('config'), body))
    return node
  }

  const adapters = new YAMLSeq()
  const projectionsAt = root.items.findIndex((pair) => keyIs(pair, 'projections'))
  if (projectionsAt < 0) {
    // v1's default projection, written out: a v2 file without adapters gets a differently named one.
    adapters.items = v1.projections.map((_, index) => instance(index, undefined))
    root.items.push(new Pair(new Scalar('adapters'), adapters))
  } else {
    const pair = root.items[projectionsAt]!
    const projections = pair.value
    const items = isSeq(projections) ? projections.items : []
    adapters.items = v1.projections.map((_, index) => {
      const item = items[index]
      return instance(index, isMap(item) ? item : undefined)
    })
    if (adapters.items.length === 0) adapters.flow = true
    if (isSeq(projections)) carryComments(projections, adapters)
    const key = new Scalar('adapters')
    if (isScalar(pair.key)) {
      key.commentBefore = pair.key.commentBefore
      key.spaceBefore = pair.key.spaceBefore
    }
    pair.key = key
    pair.value = adapters
  }

  const migrated = document.toString()

  // The file must mean what the original did: a v1 config converted as it loads.
  const reloaded = memoryConfigSchema.safeParse(parse(migrated))
  if (!reloaded.success || stableStringify(reloaded.data) !== stableStringify(fromV1Config(v1))) {
    throw new Error(
      `Could not migrate ${file}: the version 2 file would not load as the same configuration. ` +
        'It is left unchanged; please report this.'
    )
  }
  return { version: 1, text: migrated }
}
