const keyOf = (kind, id) => `${kind}\u0000${id}`;
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
export class NativeOwnership {
    store;
    indexed;
    owned = null;
    constructor(store, 
    /** Whether a record should be indexed at all; one that should not is removed instead. */
    indexed = () => true) {
        this.store = store;
        this.indexed = indexed;
    }
    async upsert(record, signal) {
        if (!this.indexed(record))
            return this.remove(record.kind, record.id, signal);
        const owned = await this.ownership(signal);
        const key = keyOf(record.kind, record.id);
        const existing = owned.get(key) ?? [];
        const kept = existing.find((native) => native.identity.revision === record.revision) ?? (await this.store.write(record, signal));
        owned.set(key, [kept, ...existing.filter((native) => native.nativeId !== kept.nativeId)]);
        await this.prune(key, kept, signal);
    }
    async remove(kind, id, signal) {
        const owned = await this.ownership(signal);
        await this.prune(keyOf(kind, id), undefined, signal);
        if ((owned.get(keyOf(kind, id)) ?? []).length === 0)
            owned.delete(keyOf(kind, id));
    }
    /** Deletes every record in the namespace, whatever the cached mapping says. */
    async clear(signal) {
        this.owned = null;
        for (const native of await this.store.list(signal))
            await this.store.delete(native, signal);
        this.owned = new Map();
    }
    /** The current mapping, read from the engine on first use. */
    async records(signal) {
        return [...(await this.ownership(signal)).values()].flat();
    }
    /** Forgets the cached mapping, so the next operation reads it from the engine again. */
    invalidate() {
        this.owned = null;
    }
    /** Deletes the input's records other than `kept`, one at a time, forgetting each as it goes. */
    async prune(key, kept, signal) {
        const owned = await this.ownership(signal);
        for (const native of [...(owned.get(key) ?? [])]) {
            if (native.nativeId === kept?.nativeId)
                continue;
            await this.store.delete(native, signal);
            owned.set(key, (owned.get(key) ?? []).filter((other) => other.nativeId !== native.nativeId));
        }
    }
    async ownership(signal) {
        if (this.owned)
            return this.owned;
        const owned = new Map();
        for (const native of await this.store.list(signal)) {
            const key = keyOf(native.identity.kind, native.identity.id);
            owned.set(key, [...(owned.get(key) ?? []), native]);
        }
        this.owned = owned;
        return owned;
    }
}
