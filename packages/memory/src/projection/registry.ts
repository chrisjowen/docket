import type { ProjectionConfig } from '../config/config.js'
import { createJsonlProjection } from './jsonl/jsonl-projection.js'
import { createMem0Projection } from './mem0/mem0-projection.js'
import type { MemoryProjection } from './projection.js'

/**
 * Built-in registry (spec §44). Dynamic package loading - e.g.
 * `type: "@company/memory-kuzu"` - would be a fallback on this lookup miss.
 */
export function createProjection(config: ProjectionConfig): MemoryProjection {
  switch (config.type) {
    case 'jsonl':
      return createJsonlProjection(config)
    case 'mem0':
      return createMem0Projection(config)
    default: {
      const type = (config as { type: unknown }).type
      throw new Error(`Unknown projection type "${String(type)}". Known types: jsonl, mem0.`)
    }
  }
}

export function createProjections(configs: readonly ProjectionConfig[]): MemoryProjection[] {
  return configs.map(createProjection)
}
