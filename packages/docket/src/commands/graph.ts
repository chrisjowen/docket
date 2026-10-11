import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readGraph } from '../open/graph.js'
import type { UiGraph } from '../open/types.js'

/** Names the contract `docket graph --json` prints, so a reader can tell it apart from docket's other JSON. */
export const GRAPH_SCHEMA = 'docket.graph'

/**
 * Bumped only for a breaking change: a field removed, renamed or retyped, or
 * its meaning changed. Adding a field is not breaking, so readers ignore
 * fields they do not know (docs/graph-json.md).
 */
export const GRAPH_SCHEMA_VERSION = 1

/**
 * What `docket graph --json` prints: the graph `docket open` serves at
 * `GET /api/graph`, under a schema name and version.
 */
export interface GraphContract extends UiGraph {
  schema: typeof GRAPH_SCHEMA
  version: typeof GRAPH_SCHEMA_VERSION
}

export interface GraphOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  root?: string | undefined
}

/**
 * Every exhibit and link, read from the canonical files, as the versioned
 * contract. Read-only: it scans, validates and reads each adapter's sync
 * manifest, and writes, syncs and connects to nothing.
 */
export const graph = async (options: GraphOptions = {}): Promise<GraphContract> => {
  const root = resolve(options.root ?? process.cwd())
  // Resolution walks up from here; from a directory that does not exist it
  // would silently find some ancestor's docket instead.
  const found = await stat(root).catch(() => undefined)
  if (!found?.isDirectory()) throw new Error(`${root} is not a directory`)
  return { schema: GRAPH_SCHEMA, version: GRAPH_SCHEMA_VERSION, ...(await readGraph(root)) }
}
