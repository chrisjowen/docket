import { rm } from 'node:fs/promises';
import { stateRootOf } from '../config/config.js';
import { ADAPTER_MANIFEST_VERSION, checkpointOf, emptyRecords, listAdapterManifests, readAdapterManifest, resetPendingFingerprint } from './adapter-manifest.js';
import { entryPaths, manifestPath, readManifest } from './manifest.js';
const empty = (identity) => {
    const records = emptyRecords();
    return {
        version: ADAPTER_MANIFEST_VERSION,
        adapter: identity.id,
        fingerprint: identity.fingerprint,
        scope: identity.scope,
        definition: { name: '', version: '' },
        inputs: [],
        checkpoint: checkpointOf(records),
        owners: {},
        records
    };
};
const vouchesFor = (manifest, identity) => manifest.fingerprint === identity.fingerprint && manifest.scope === identity.scope;
/**
 * Each instance's manifest, deciding for each whether what it records can be
 * trusted (docs/adapter-spec.md §8). One instance's manifest never stands in
 * for another's, except an orphan adopted by a renamed instance, which is
 * the same target by fingerprint.
 *
 * The legacy single manifest is migrated rather than discarded where it
 * still vouches for the configured projections, so upgrading reprojects
 * nothing that was projected before. Its records are entities only: input
 * kinds an instance had never been handed are projected as new.
 */
export const loadAdapterManifests = async (resolved, identities, options) => {
    const stateRoot = stateRootOf(resolved);
    const configured = new Set(options.configured);
    const fresh = (id) => options.fresh === true || (options.fresh instanceof Set && options.fresh.has(id));
    const orphans = new Map();
    for (const id of await listAdapterManifests(stateRoot)) {
        if (configured.has(id) || identities.some((identity) => identity.id === id))
            continue;
        const orphan = await readAdapterManifest(stateRoot, id);
        if (orphan)
            orphans.set(id, orphan);
    }
    let legacy;
    const readLegacy = async () => {
        legacy ??= await readManifest(stateRoot);
        return legacy.projections === options.legacyFingerprint ? legacy : undefined;
    };
    const loaded = new Map();
    for (const identity of identities) {
        if (fresh(identity.id)) {
            loaded.set(identity.id, { manifest: empty(identity), origin: 'rebuilt', reset: true });
            continue;
        }
        const own = await readAdapterManifest(stateRoot, identity.id);
        if (own && vouchesFor(own, identity)) {
            loaded.set(identity.id, { manifest: own, origin: 'current', reset: false });
            continue;
        }
        if (own) {
            const interrupted = own.fingerprint === resetPendingFingerprint(identity.fingerprint) && own.scope === identity.scope;
            loaded.set(identity.id, { manifest: empty(identity), origin: interrupted ? 'interrupted' : 'reconfigured', reset: true });
            continue;
        }
        const adoptable = [...orphans].find(([, orphan]) => vouchesFor(orphan, identity));
        if (adoptable) {
            const [from, orphan] = adoptable;
            orphans.delete(from);
            loaded.set(identity.id, {
                manifest: { ...orphan, adapter: identity.id },
                origin: 'adopted',
                reset: false,
                adoptedFrom: from
            });
            continue;
        }
        const previous = await readLegacy();
        if (previous) {
            const manifest = empty(identity);
            for (const [id, entry] of Object.entries(previous.documents)) {
                manifest.owners[id] = entryPaths(entry);
                manifest.records.entity[id] = { revision: entry.hash };
            }
            manifest.inputs = ['entity'];
            manifest.checkpoint = checkpointOf(manifest.records);
            loaded.set(identity.id, { manifest, origin: 'migrated', reset: false });
            continue;
        }
        loaded.set(identity.id, { manifest: empty(identity), origin: 'created', reset: true });
    }
    return loaded;
};
/**
 * Removes the legacy single manifest once every configured instance has its
 * own, so nothing is left to mistake for current state. Until then it stays,
 * for the instances still to migrate from it.
 */
export const retireLegacyManifest = async (resolved, configured) => {
    const stateRoot = stateRootOf(resolved);
    const written = new Set(await listAdapterManifests(stateRoot));
    if (configured.every((id) => written.has(id)))
        await rm(manifestPath(stateRoot), { force: true });
};
