import { randomUUID } from 'node:crypto'

import {
  unacknowledged,
  type InputKind,
  type MemoryAdapter,
  type ProjectionBatch,
  type ProjectionPort
} from '@docket/contracts'

import type { AdapterSlot, Docket } from '../adapters/docket.js'
import { stateRootOf, type ResolvedConfig } from '../config/config.js'
import {
  Checkpoint,
  emptyRecords,
  INPUT_KINDS,
  removeAdapterManifest,
  writeAdapterManifest,
  type AdapterManifest
} from '../manifest/adapter-manifest.js'
import { planAdapter, type PlannedChange } from '../manifest/plan.js'
import { loadAdapterManifests, retireLegacyManifest, type ManifestOrigin } from '../manifest/state.js'
import type { CanonicalState } from '../sync/inputs.js'

/** Changes per batch. A batch is not atomic; this bounds what one request carries. */
export const BATCH_SIZE = 100

/** Attempts per change within one pass. A change still failing waits for the next pass. */
export const ATTEMPTS = 2

/** One canonical input, by kind and id. */
export interface RecordRef {
  kind: InputKind
  id: string
}

export interface RecordFailure extends RecordRef {
  retryable: boolean
  message: string
}

/** What one pass did to one adapter instance. */
export interface PassReport {
  id: string
  upserted: RecordRef[]
  removed: RecordRef[]
  unchanged: number
  /** Entities a broken file held at what the instance last acknowledged. */
  held: string[]
  /** Changes the instance failed or did not acknowledge, after retrying. They stay pending. */
  failed: RecordFailure[]
  /** Why the pass stopped short: the instance could not be reached, or threw. */
  error?: string
}

/** One adapter instance's sync, from opening to its manifest written. */
export interface TargetReport extends PassReport {
  /** The input kinds it declared. */
  inputs: InputKind[]
  origin: ManifestOrigin
  /** Its namespace was reset before projecting. */
  reset: boolean
  /** Its checkpoint once the manifest was written. Absent when nothing could be written. */
  checkpoint?: string
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const changeRef = ({ change }: PlannedChange): RecordRef =>
  change.operation === 'upsert' ? { kind: change.record.kind, id: change.record.id } : { kind: change.kind, id: change.id }

/** Splits changes into batches whose ids are unique, as receipts name changes by id alone. */
const batchesOf = (changes: readonly PlannedChange[]): PlannedChange[][] => {
  const batches: PlannedChange[][] = []
  let batch: PlannedChange[] = []
  let ids = new Set<string>()
  for (const planned of changes) {
    const { id } = changeRef(planned)
    if (batch.length >= BATCH_SIZE || ids.has(id)) {
      batches.push(batch)
      batch = []
      ids = new Set()
    }
    batch.push(planned)
    ids.add(id)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

interface TargetContext {
  resolved: ResolvedConfig
  manifest: AdapterManifest
  origin: ManifestOrigin
  reset: boolean
  adoptedFrom?: string | undefined
}

/**
 * One adapter instance and its manifest. Everything that can go wrong with
 * the instance is caught and reported against it, never thrown into the
 * others: each has its own manifest, written only from what it acknowledged.
 */
class ProjectionTarget {
  private adapter: MemoryAdapter | undefined
  private port: ProjectionPort | undefined
  private inputs: InputKind[] = []
  /** What the instance holds as far as it has acknowledged, ahead of the written manifest until committed. */
  private manifest: AdapterManifest
  private checkpoint: Checkpoint
  /** Something was acknowledged, or the manifest is new, since the last commit. */
  private dirty: boolean
  private opened = false
  private failure: string | undefined
  private readonly origin: ManifestOrigin
  private readonly reset: boolean
  private adoptedFrom: string | undefined
  private committedCheckpoint: string | undefined
  private totals: PassReport

  constructor(
    readonly slot: AdapterSlot,
    private readonly context: TargetContext
  ) {
    this.manifest = context.manifest
    this.checkpoint = Checkpoint.of(context.manifest.records)
    this.origin = context.origin
    this.reset = context.reset
    this.adoptedFrom = context.adoptedFrom
    this.dirty = context.origin !== 'current'
    this.totals = this.blankPass()
  }

  get id(): string {
    return this.slot.id
  }

  /** Why the instance cannot be synced, when it cannot. */
  get error(): string | undefined {
    return this.failure
  }

  /** Every entity the manifest records, with its files. */
  get owners(): Readonly<AdapterManifest['owners']> {
    return this.manifest.owners
  }

  /** The revision of an entity the instance holds, when it takes entities. */
  entityRevision(id: string): string | undefined {
    return this.manifest.records.entity[id]?.revision
  }

  /**
   * Creates the instance and settles its manifest against what it declares:
   * kinds it no longer takes are forgotten, and a manifest nothing vouches
   * for resets the instance's own namespace - only that, never a store
   * globally - so everything is projected again.
   */
  async open(): Promise<void> {
    try {
      const adapter = await this.slot.create()
      this.adapter = adapter
      const description = adapter.describe()
      this.port = adapter.projection
      this.inputs = this.port ? INPUT_KINDS.filter((kind) => description.inputs.includes(kind)) : []

      const records = emptyRecords()
      for (const kind of this.inputs) records[kind] = this.manifest.records[kind]
      this.manifest = {
        ...this.manifest,
        definition: { name: description.name, version: description.version },
        inputs: [...this.inputs],
        records
      }
      this.checkpoint = Checkpoint.of(records)

      if (this.reset) {
        await writeAdapterManifest(stateRootOf(this.context.resolved), { ...this.manifest, owners: {} })
        await this.port?.reset(this.slot.scope)
      }
      this.opened = true
    } catch (cause) {
      this.failure = messageOf(cause)
    }
  }

  /** Plans and applies what changed for `scope` (every entity when absent), recording what was acknowledged. */
  async apply(state: CanonicalState, broken: ReadonlySet<string>, scope?: ReadonlySet<string>): Promise<PassReport> {
    const pass = this.blankPass()
    if (!this.opened) return { ...pass, ...(this.failure !== undefined ? { error: this.failure } : {}) }

    const plan = planAdapter(state, this.manifest, { inputs: new Set(this.inputs), broken, scope })
    pass.unchanged = plan.unchanged
    pass.held = [...plan.held]
    if (JSON.stringify(plan.owners) !== JSON.stringify(this.manifest.owners)) this.dirty = true
    this.manifest = { ...this.manifest, owners: plan.owners }

    if (this.port) {
      let pending = plan.changes
      for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt += 1) {
        const retry: PlannedChange[] = []
        for (const batch of batchesOf(pending)) {
          const outcome = await this.applyBatch(this.port, batch, pass)
          if (outcome.error !== undefined) {
            pass.error = outcome.error
            this.record(pass)
            return pass
          }
          for (const failure of outcome.failures) {
            const planned = batch.find((change) => changeRef(change).id === failure.id)
            if (failure.retryable && attempt < ATTEMPTS && planned) retry.push(planned)
            else pass.failed.push(failure)
          }
        }
        pending = retry
      }
    }
    this.record(pass)
    return pass
  }

  /**
   * Flushes, then writes the manifest: it vouches for what the instance holds,
   * so it must never get ahead of it. A flush that fails writes nothing - what
   * was acknowledged but not flushed is replayed next pass, which is safe
   * because applying a change twice must not duplicate it.
   */
  async commit(): Promise<string | undefined> {
    if (!this.opened || !this.dirty) return undefined
    try {
      await this.port?.flush?.()
      const stateRoot = stateRootOf(this.context.resolved)
      await writeAdapterManifest(stateRoot, this.manifest)
      if (this.adoptedFrom !== undefined) {
        await removeAdapterManifest(stateRoot, this.adoptedFrom)
        this.adoptedFrom = undefined
      }
      this.committedCheckpoint = this.checkpoint.toString()
      this.dirty = false
      return undefined
    } catch (cause) {
      const message = `could not record what it holds: ${messageOf(cause)}`
      this.totals.error ??= message
      return message
    }
  }

  async close(): Promise<string | undefined> {
    try {
      await this.adapter?.close()
      return undefined
    } catch (cause) {
      const message = `could not close: ${messageOf(cause)}`
      this.totals.error ??= message
      return message
    }
  }

  /** Everything since the instance was opened. */
  report(): TargetReport {
    return {
      ...this.totals,
      ...(this.failure !== undefined ? { error: this.failure } : {}),
      inputs: [...this.inputs],
      origin: this.origin,
      reset: this.reset,
      ...(this.committedCheckpoint !== undefined ? { checkpoint: this.committedCheckpoint } : {})
    }
  }

  /** The checkpoint every change in the batch, once acknowledged, would leave the instance at. */
  private batchCheckpoint(batch: readonly PlannedChange[]): string {
    const next = this.checkpoint.copy()
    for (const { change } of batch) {
      if (change.operation === 'upsert') {
        const previous = this.manifest.records[change.record.kind][change.record.id]
        if (previous) next.delete(change.record.kind, change.record.id, previous.revision)
        next.add(change.record.kind, change.record.id, change.record.revision)
      } else {
        const previous = this.manifest.records[change.kind][change.id]
        if (previous) next.delete(change.kind, change.id, previous.revision)
      }
    }
    return next.toString()
  }

  /**
   * One batch. Only what the receipt names applied advances the manifest;
   * a failed change keeps its previous entry, so it is retried. A change the
   * receipt leaves out was not acknowledged, and counts as a retryable
   * failure. A throw acknowledges nothing in the batch.
   */
  private async applyBatch(
    port: ProjectionPort,
    batch: readonly PlannedChange[],
    pass: PassReport
  ): Promise<{ failures: RecordFailure[]; error?: string }> {
    const projection: ProjectionBatch = {
      batchId: randomUUID(),
      scope: this.slot.scope,
      checkpoint: this.batchCheckpoint(batch),
      changes: batch.map(({ change }) => change)
    }
    let receipt
    try {
      receipt = await port.apply(projection)
    } catch (cause) {
      return { failures: [], error: messageOf(cause) }
    }

    const applied = new Set(receipt.applied)
    const failures: RecordFailure[] = receipt.failed.flatMap((failure) => {
      const planned = batch.find((change) => changeRef(change).id === failure.id)
      return planned ? [{ ...changeRef(planned), retryable: failure.retryable, message: failure.message }] : []
    })
    for (const id of unacknowledged(projection, receipt)) {
      const planned = batch.find((change) => changeRef(change).id === id)
      if (planned) failures.push({ ...changeRef(planned), retryable: true, message: 'not acknowledged' })
    }

    for (const planned of batch) {
      const ref = changeRef(planned)
      if (!applied.has(ref.id)) continue
      const records = this.manifest.records[ref.kind]
      const previous = records[ref.id]
      if (previous) this.checkpoint.delete(ref.kind, ref.id, previous.revision)
      if (planned.change.operation === 'upsert') {
        const { revision } = planned.change.record
        records[ref.id] = { revision, ...(planned.owner !== ref.id ? { owner: planned.owner } : {}) }
        this.checkpoint.add(ref.kind, ref.id, revision)
        pass.upserted.push(ref)
      } else {
        delete records[ref.id]
        pass.removed.push(ref)
      }
      this.dirty = true
    }
    return { failures }
  }

  private record(pass: PassReport): void {
    this.totals.upserted.push(...pass.upserted)
    this.totals.removed.push(...pass.removed)
    this.totals.unchanged = pass.unchanged
    this.totals.held = pass.held
    this.totals.failed.push(...pass.failed)
    if (pass.error !== undefined) this.totals.error ??= pass.error
  }

  private blankPass(): PassReport {
    return { id: this.slot.id, upserted: [], removed: [], unchanged: 0, held: [], failed: [] }
  }
}

export interface OpenProjectionsOptions {
  resolved: ResolvedConfig
  /** `Docket.projectionsFingerprint`, which the legacy single manifest was keyed by. */
  legacyFingerprint: string
  /** Every instance `.docket.yaml` enables for projection, synced now or not. */
  configured: readonly string[]
  /** Reset these instances (`true`: all) and project everything into them - `docket rebuild`. */
  fresh?: boolean | ReadonlySet<string> | undefined
}

/**
 * Drives the adapter instances enabled for projection, each against its own
 * manifest (docs/adapter-spec.md §8). Instances run concurrently and
 * independently: one that cannot be reached, fails a change or throws is
 * reported against its id while the others carry on, and its manifest only
 * ever records what it acknowledged.
 */
export class ProjectionManager {
  private constructor(
    private readonly targets: ProjectionTarget[],
    private readonly options: OpenProjectionsOptions
  ) {}

  /** The instances of `docket` enabled for projection - or only `only`, when given. */
  static forDocket(
    docket: Docket,
    options: { only?: readonly string[] | undefined; fresh?: boolean | undefined } = {}
  ): Promise<ProjectionManager> {
    const projecting = docket.adapters.filter((slot) => slot.roles.includes('projection'))
    const configured = docket.resolved.config.adapters
      .filter((adapter) => adapter.roles.includes('projection'))
      .map((adapter) => adapter.id)
    const selected = options.only === undefined ? projecting : selectSlots(docket.adapters, options.only)
    return ProjectionManager.open(selected, {
      resolved: docket.resolved,
      legacyFingerprint: docket.projectionsFingerprint,
      configured,
      fresh: options.fresh === true ? new Set(selected.map((slot) => slot.id)) : undefined
    })
  }

  /** Opens each slot enabled for projection, each settling its own manifest. One failing to open fails only itself. */
  static async open(slots: readonly AdapterSlot[], options: OpenProjectionsOptions): Promise<ProjectionManager> {
    const enabled = slots.filter((slot) => slot.roles.includes('projection'))
    const manifests = await loadAdapterManifests(
      options.resolved,
      enabled.map(({ id, fingerprint, scope }) => ({ id, fingerprint, scope })),
      options
    )
    const targets = enabled.map((slot) => {
      const loaded = manifests.get(slot.id)!
      return new ProjectionTarget(slot, { resolved: options.resolved, ...loaded })
    })
    await Promise.all(targets.map((target) => target.open()))
    return new ProjectionManager(targets, options)
  }

  /** Instances that could not be opened, by id, with why. */
  get failures(): { id: string; error: string }[] {
    return this.targets.flatMap((target) => (target.error === undefined ? [] : [{ id: target.id, error: target.error }]))
  }

  /** Every entity any instance's manifest records, with the files it was last read from. */
  knownOwners(): Map<string, { paths: string[]; revision?: string }> {
    const known = new Map<string, { paths: string[]; revision?: string }>()
    for (const target of this.targets) {
      for (const [id, paths] of Object.entries(target.owners)) {
        const entry = known.get(id) ?? { paths: [] }
        for (const path of paths) if (!entry.paths.includes(path)) entry.paths.push(path)
        entry.revision ??= target.entityRevision(id)
        known.set(id, entry)
      }
    }
    return known
  }

  /** Brings every instance up to `state` for `scope` (every entity when absent). */
  apply(state: CanonicalState, broken: ReadonlySet<string>, scope?: ReadonlySet<string>): Promise<PassReport[]> {
    return Promise.all(this.targets.map((target) => target.apply(state, broken, scope)))
  }

  /**
   * Flushes each instance and writes its manifest, then retires the legacy
   * manifest once every configured instance has its own. Returns the
   * instances that could not record what they hold.
   */
  async commit(): Promise<{ id: string; error: string }[]> {
    const results = await Promise.all(this.targets.map(async (target) => ({ id: target.id, error: await target.commit() })))
    await retireLegacyManifest(this.options.resolved, this.options.configured)
    return results.flatMap(({ id, error }) => (error === undefined ? [] : [{ id, error }]))
  }

  async close(): Promise<{ id: string; error: string }[]> {
    const results = await Promise.all(this.targets.map(async (target) => ({ id: target.id, error: await target.close() })))
    return results.flatMap(({ id, error }) => (error === undefined ? [] : [{ id, error }]))
  }

  reports(): TargetReport[] {
    return this.targets.map((target) => target.report())
  }
}

/**
 * The slots `ids` name, in configuration order, each checked to exist and be
 * enabled for projection, so `--adapter` never syncs nothing silently.
 */
export const selectSlots = (slots: readonly AdapterSlot[], ids: readonly string[]): AdapterSlot[] => {
  const known = slots.map((slot) => slot.id)
  for (const id of ids) {
    const slot = slots.find((candidate) => candidate.id === id)
    if (!slot) {
      throw new Error(
        `No adapter instance "${id}" is configured.${known.length > 0 ? ` Configured instances: ${known.join(', ')}.` : ''}`
      )
    }
    if (!slot.roles.includes('projection')) {
      throw new Error(`Adapter "${id}" is not enabled for projection; its roles are ${slot.roles.join(', ') || 'none'}.`)
    }
  }
  const wanted = new Set(ids)
  return slots.filter((slot) => wanted.has(slot.id))
}
