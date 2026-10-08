import type { ProjectionConfig } from '../config/config.js'
import { createJsonlProjection } from './jsonl/jsonl-projection.js'
import { createMem0Projection } from './mem0/mem0-projection.js'
import { createNeo4jProjection } from './neo4j/neo4j-projection.js'
import type { MemoryProjection } from './projection.js'

/**
 * Built-in registry (spec §44): the projection a v1 config entry names. The
 * compatibility adapter definitions in `adapters/compat.ts` create projections
 * through it; other adapters are loaded as modules (docs/adapter-spec.md §4).
 */
export function createProjection(config: ProjectionConfig): MemoryProjection {
  switch (config.type) {
    case 'jsonl':
      return createJsonlProjection(config)
    case 'mem0':
      return createMem0Projection(config)
    case 'neo4j':
      return createNeo4jProjection(config)
    default: {
      const type = (config as { type: unknown }).type
      throw new Error(`Unknown projection type "${String(type)}". Known types: jsonl, mem0, neo4j.`)
    }
  }
}
