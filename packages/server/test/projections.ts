import { entityProjectionAdapter, type EntityInput, type MemoryAdapter } from '@chrisjowen/docket'

import type { ConnectedProjections, ProjectionSet } from '../src/runtime/reconcile.js'

/**
 * In-memory projections for the runtime's tests: each instance holds the
 * entities projected into it, per workspace, and searches them by the
 * question's words in their title, id and body. Each can be made to fail as a
 * store does: unreachable, refusing a reset, or throwing on apply.
 */
export interface MemoryProjections extends ProjectionSet {
  /** What an instance holds for a workspace, by id. */
  held(instance: string, workspaceId: string): Map<string, EntityInput>
  /** How each instance fails from now on; `{}` heals it. */
  fail(instance: string, how: { connect?: string; reset?: string; apply?: string }): void
  /** The adapters a query is put to, opened as the pipeline opens them. */
  adapters(workspaceId: string): Record<string, MemoryAdapter>
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

export function memoryProjections(instances: readonly string[] = ['graph', 'memories']): MemoryProjections {
  const stores = new Map<string, Map<string, Map<string, EntityInput>>>()
  const failures = new Map<string, { connect?: string; reset?: string; apply?: string }>()
  const held = (instance: string, workspaceId: string) => {
    const byWorkspace = stores.get(instance) ?? new Map<string, Map<string, EntityInput>>()
    stores.set(instance, byWorkspace)
    const entities = byWorkspace.get(workspaceId) ?? new Map<string, EntityInput>()
    byWorkspace.set(workspaceId, entities)
    return entities
  }
  const open = (instance: string, workspaceId: string): MemoryAdapter => {
    const entities = held(instance, workspaceId)
    const failing = () => failures.get(instance) ?? {}
    return entityProjectionAdapter(
      {
        name: instance,
        async upsert(entity) {
          if (failing().apply) throw new Error(failing().apply)
          entities.set(entity.id, entity)
        },
        async remove(id) {
          if (failing().apply) throw new Error(failing().apply)
          entities.delete(id)
        },
        async reset() {
          if (failing().reset) throw new Error(failing().reset)
          entities.clear()
        },
        async search(query, limit) {
          const terms = new Set(words(query))
          const hits = [...entities.values()]
            // The share of the question's words a record holds: a score from 0 to 1, as a similarity is.
            .map((entity) => {
              const held = new Set(words(`${entity.id} ${entity.title} ${entity.content}`))
              return { entity, score: [...terms].filter((term) => held.has(term)).length / (terms.size || 1) }
            })
            .filter((hit) => hit.score > 0)
            .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id))
            .slice(0, limit)
          return { hits: hits.map(({ entity, score }) => ({ id: entity.id, score, revision: entity.revision })) }
        }
      },
      { version: '1.0.0' }
    )
  }
  return {
    instances,
    async connect(_scope, workspaceId): Promise<ConnectedProjections> {
      return {
        fingerprint: (instance) => `memory:${instance}`,
        async open(instance) {
          const refused = failures.get(instance)?.connect
          if (refused) throw new Error(refused)
          return open(instance, workspaceId)
        }
      }
    },
    held,
    fail: (instance, how) => void failures.set(instance, how),
    adapters: (workspaceId) => Object.fromEntries(instances.map((instance) => [instance, open(instance, workspaceId)]))
  }
}
