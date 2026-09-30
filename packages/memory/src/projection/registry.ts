import type { ProjectionConfig } from '../config/config.js'
import { createFileProjection } from './file/file-projection.js'
import type { MemoryProjection } from './projection.js'

export type ProjectionFactory = (config: ProjectionConfig) => MemoryProjection

/**
 * Built-in registry only for v0 (spec §44). Dynamic package loading - e.g.
 * `type: "@company/memory-kuzu"` - would be a fallback on this lookup miss.
 */
const projectionFactories: Record<string, ProjectionFactory> = {
  file: createFileProjection
}

export function createProjection(config: ProjectionConfig): MemoryProjection {
  const factory = projectionFactories[config.type]
  if (!factory) {
    const known = Object.keys(projectionFactories).sort().join(', ')
    throw new Error(`Unknown projection type "${config.type}". Known types: ${known}.`)
  }
  return factory(config)
}

export function createProjections(configs: readonly ProjectionConfig[]): MemoryProjection[] {
  return configs.map(createProjection)
}
