import { randomUUID } from 'node:crypto'

import { unacknowledged, type MemoryAdapter, type ProjectionPort, type RecordChange } from '@docket/contracts'

import { toEntityInput } from '../adapters/compat.js'
import { DEFAULT_SCOPE, type AdapterSlot } from '../adapters/docket.js'
import type { MemoryEntity } from '../model/index.js'

/** An adapter instance the manager drives, by its instance id. */
export interface ManagedAdapter {
  id: string
  adapter: MemoryAdapter
}

interface Target extends ManagedAdapter {
  port: ProjectionPort | undefined
  /** Whether it declares entity inputs; only declared kinds are delivered. */
  entities: boolean
}

/** Stands in for a removed record's revision when the manifest did not record one. */
const UNKNOWN_REVISION = 'unknown'

/**
 * Fans every mutation out to the adapters enabled for projection (spec §26),
 * as single-change batches through their projection ports.
 *
 * Adapters run concurrently and independently: one failing must not stop the
 * others, and must never be swallowed. Callers get an `AggregateError` naming
 * the adapters that failed - a change an adapter failed, or did not
 * acknowledge, is a failure.
 *
 * There is no ordering guarantee between adapters, and none is needed -
 * desired state is always re-derivable from the canonical files, so a mutation
 * is a hint that reconciliation is due rather than an ordered log (spec §69).
 */
export class ProjectionManager {
  private readonly targets: Target[]

  constructor(
    adapters: readonly ManagedAdapter[],
    private readonly scope: string = DEFAULT_SCOPE
  ) {
    this.targets = adapters.map(({ id, adapter }) => ({
      id,
      adapter,
      port: adapter.projection,
      entities: adapter.projection !== undefined && adapter.describe().inputs.includes('entity')
    }))
  }

  /**
   * Creates every slot enabled for projection. If any fails to start, the
   * ones that did are closed again and the failures thrown together.
   */
  static async open(slots: readonly AdapterSlot[], scope: string = DEFAULT_SCOPE): Promise<ProjectionManager> {
    const enabled = slots.filter((slot) => slot.roles.includes('projection'))
    const results = await Promise.allSettled(enabled.map((slot) => slot.create()))

    const failures = results.flatMap((result, index) =>
      result.status === 'rejected' ? [{ id: enabled[index]?.id ?? 'unknown', reason: result.reason as unknown }] : []
    )
    const created = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [{ id: enabled[index]?.id ?? 'unknown', adapter: result.value }] : []
    )

    if (failures.length > 0) {
      await Promise.allSettled(created.map(({ adapter }) => adapter.close()))
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        `projection init failed: ${failures.map((failure) => failure.id).join(', ')}`
      )
    }

    try {
      return new ProjectionManager(created, scope)
    } catch (cause) {
      await Promise.allSettled(created.map(({ adapter }) => adapter.close()))
      throw cause
    }
  }

  async upsert(entity: MemoryEntity): Promise<void> {
    await this.apply('upsert', {
      operation: 'upsert',
      record: toEntityInput(entity, this.scope)
    })
  }

  /** `revision` is the one last projected, when the caller knows it. */
  async remove(id: string, revision: string = UNKNOWN_REVISION): Promise<void> {
    await this.apply('remove', { operation: 'remove', kind: 'entity', id, revision })
  }

  async flush(): Promise<void> {
    await this.fanOut('flush', (target) => target.port?.flush?.())
  }

  async reset(): Promise<void> {
    await this.fanOut('reset', (target) => target.port?.reset(this.scope))
  }

  async close(): Promise<void> {
    await this.fanOut('close', (target) => target.adapter.close())
  }

  private async apply(operation: string, change: RecordChange): Promise<void> {
    const checkpoint = change.operation === 'upsert' ? change.record.revision : change.revision
    await this.fanOut(operation, async (target) => {
      if (!target.port || !target.entities) return
      const batch = { batchId: randomUUID(), scope: this.scope, checkpoint, changes: [change] }
      const receipt = await target.port.apply(batch)
      const failed = receipt.failed.map((failure) => `${failure.id}: ${failure.message}`)
      const missing = unacknowledged(batch, receipt).map((id) => `${id}: not acknowledged`)
      if (failed.length + missing.length > 0) throw new Error([...failed, ...missing].join('; '))
    })
  }

  private async fanOut(
    operation: string,
    run: (target: Target) => Promise<void> | undefined
  ): Promise<void> {
    const results = await Promise.allSettled(this.targets.map(async (target) => run(target)))

    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ id: this.targets[index]?.id ?? 'unknown', reason: result.reason as unknown }]
        : []
    )
    if (failures.length === 0) return

    throw new AggregateError(
      failures.map(failure => failure.reason),
      `projection ${operation} failed: ${failures.map(failure => failure.id).join(', ')}`
    )
  }
}
