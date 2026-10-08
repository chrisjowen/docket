import type { CanonicalInput, InputKind } from '@docket/contracts'

import type { PassageSink } from './passage-projection.js'

/** Which canonical input, at which revision, a native record was written for. */
export interface NativeIdentity {
  kind: InputKind
  id: string
  revision: string
}

/** One native record - a frame, a drawer - and the identity the engine stores with it. */
export interface NativeRecord {
  nativeId: string
  identity: NativeIdentity
}

/**
 * An engine that keeps each record's canonical identity in its own metadata,
 * and can list, write and delete records within one namespace.
 */
export interface NativeStore {
  /** Every record in the namespace that carries a docket identity. Must be complete, or throw. */
  list(signal?: AbortSignal): Promise<NativeRecord[]>
  /** Stores `record` with its identity; resolves to what was stored. Writing an identical record again must not duplicate it. */
  write(record: CanonicalInput, signal?: AbortSignal): Promise<NativeRecord>
  delete(record: NativeRecord, signal?: AbortSignal): Promise<void>
}

const keyOf = (kind: InputKind, id: string): string => `${kind}\u0000${id}`

/**
 * The canonical-to-native mapping, read from the engine itself: which native
 * records hold which canonical input. Nothing is kept locally, so a crash
 * between a write and a delete leaves nothing the next pass cannot see.
 *
 * An upsert writes the new revision first, then deletes every other record of
 * that input - an earlier revision, or a duplicate a crash left behind - so
 * the input is never missing, and once the upsert returns no stale record of
 * it is current. Replaying a revision already stored writes nothing.
 */
export class NativeOwnership implements PassageSink {
  private owned: Map<string, NativeRecord[]> | null = null

  constructor(
    private readonly store: NativeStore,
    /** Whether a record should be indexed at all; one that should not is removed instead. */
    private readonly indexed: (record: CanonicalInput) => boolean = () => true
  ) {}

  async upsert(record: CanonicalInput, signal?: AbortSignal): Promise<void> {
    if (!this.indexed(record)) return this.remove(record.kind, record.id, signal)
    const owned = await this.ownership(signal)
    const key = keyOf(record.kind, record.id)
    const existing = owned.get(key) ?? []
    const kept = existing.find((native) => native.identity.revision === record.revision) ?? (await this.store.write(record, signal))
    owned.set(key, [kept, ...existing.filter((native) => native.nativeId !== kept.nativeId)])
    await this.prune(key, kept, signal)
  }

  async remove(kind: InputKind, id: string, signal?: AbortSignal): Promise<void> {
    const owned = await this.ownership(signal)
    await this.prune(keyOf(kind, id), undefined, signal)
    if ((owned.get(keyOf(kind, id)) ?? []).length === 0) owned.delete(keyOf(kind, id))
  }

  /** Deletes every record in the namespace, whatever the cached mapping says. */
  async clear(signal?: AbortSignal): Promise<void> {
    this.owned = null
    for (const native of await this.store.list(signal)) await this.store.delete(native, signal)
    this.owned = new Map()
  }

  /** The current mapping, read from the engine on first use. */
  async records(signal?: AbortSignal): Promise<NativeRecord[]> {
    return [...(await this.ownership(signal)).values()].flat()
  }

  /** Forgets the cached mapping, so the next operation reads it from the engine again. */
  invalidate(): void {
    this.owned = null
  }

  /** Deletes the input's records other than `kept`, one at a time, forgetting each as it goes. */
  private async prune(key: string, kept: NativeRecord | undefined, signal?: AbortSignal): Promise<void> {
    const owned = await this.ownership(signal)
    for (const native of [...(owned.get(key) ?? [])]) {
      if (native.nativeId === kept?.nativeId) continue
      await this.store.delete(native, signal)
      owned.set(key, (owned.get(key) ?? []).filter((other) => other.nativeId !== native.nativeId))
    }
  }

  private async ownership(signal?: AbortSignal): Promise<Map<string, NativeRecord[]>> {
    if (this.owned) return this.owned
    const owned = new Map<string, NativeRecord[]>()
    for (const native of await this.store.list(signal)) {
      const key = keyOf(native.identity.kind, native.identity.id)
      owned.set(key, [...(owned.get(key) ?? []), native])
    }
    this.owned = owned
    return owned
  }
}
