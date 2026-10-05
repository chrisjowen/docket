import type { MemoryEntity } from '../model/index.js'
import type { MemoryProjection, ProjectionContext } from './projection.js'

/**
 * Fans every mutation out to the configured projections (spec §26).
 *
 * Projections run concurrently and independently: one failing must not stop the
 * others, and must never be swallowed. Callers get an `AggregateError` naming
 * the projections that failed.
 *
 * There is no ordering guarantee between projections, and none is needed -
 * desired state is always re-derivable from the canonical files, so a mutation
 * is a hint that reconciliation is due rather than an ordered log (spec §69).
 */
export class ProjectionManager {
  constructor(private readonly projections: readonly MemoryProjection[]) {}

  async init(context: ProjectionContext): Promise<void> {
    await this.fanOut('init', projection => projection.init?.(context))
  }

  async upsert(entity: MemoryEntity): Promise<void> {
    await this.fanOut('upsert', projection => projection.upsert(entity))
  }

  async remove(id: string): Promise<void> {
    await this.fanOut('remove', projection => projection.remove(id))
  }

  async flush(): Promise<void> {
    await this.fanOut('flush', projection => projection.flush?.())
  }

  async reset(): Promise<void> {
    await this.fanOut('reset', projection => projection.reset?.())
  }

  async close(): Promise<void> {
    await this.fanOut('close', projection => projection.close?.())
  }

  private async fanOut(
    operation: string,
    run: (projection: MemoryProjection) => Promise<void> | undefined
  ): Promise<void> {
    const results = await Promise.allSettled(this.projections.map(run))

    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ name: this.projections[index]?.name ?? 'unknown', reason: result.reason as unknown }]
        : []
    )
    if (failures.length === 0) return

    throw new AggregateError(
      failures.map(failure => failure.reason),
      `projection ${operation} failed: ${failures.map(failure => failure.name).join(', ')}`
    )
  }
}
