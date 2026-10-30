import { createHash } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stableStringify, writeFileAtomic } from '../bundled/adapter-kit/dist/index.js';
export const ADAPTER_MANIFEST_VERSION = 2;
/** Every adapter instance's manifest is `<state.dir>/manifests/<instance id>.json`. */
export const MANIFESTS_DIRNAME = 'manifests';
export const INPUT_KINDS = ['entity', 'observation', 'document'];
/** The fingerprint a manifest carries while its instance's reset is unfinished: it matches no configuration. */
export const resetPendingFingerprint = (fingerprint) => `reset-pending:${fingerprint}`;
export const emptyRecords = () => ({ entity: {}, observation: {}, document: {} });
export const manifestsDir = (stateRoot) => join(stateRoot, MANIFESTS_DIRNAME);
export const adapterManifestPath = (stateRoot, adapter) => join(manifestsDir(stateRoot), `${adapter}.json`);
const MODULUS = 1n << 256n;
const entryDigest = (kind, id, revision) => BigInt(`0x${createHash('sha256').update(`${kind}\u0000${id}\u0000${revision}`).digest('hex')}`);
/**
 * A checkpoint identifies a set of (kind, id, revision) records: the sum of
 * their hashes, modulo 2^256. Order-independent and updated one record at a
 * time, so every batch of a pass can carry the checkpoint of exactly what the
 * instance will hold once it is acknowledged, and the same records always
 * give the same checkpoint.
 */
export class Checkpoint {
    sum = 0n;
    static of(records) {
        const checkpoint = new Checkpoint();
        for (const kind of INPUT_KINDS) {
            for (const [id, entry] of Object.entries(records[kind]))
                checkpoint.add(kind, id, entry.revision);
        }
        return checkpoint;
    }
    add(kind, id, revision) {
        this.sum = (this.sum + entryDigest(kind, id, revision)) % MODULUS;
    }
    delete(kind, id, revision) {
        this.sum = (this.sum - entryDigest(kind, id, revision) + MODULUS) % MODULUS;
    }
    copy() {
        const copy = new Checkpoint();
        copy.sum = this.sum;
        return copy;
    }
    toString() {
        return `records:${this.sum.toString(16).padStart(64, '0')}`;
    }
}
export const checkpointOf = (records) => Checkpoint.of(records).toString();
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
/** Absent, unreadable or not this version: `undefined`, which vouches for nothing - the manifest is derived state. */
export const parseAdapterManifest = (raw) => {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.version !== ADAPTER_MANIFEST_VERSION)
        return undefined;
    const { adapter, fingerprint, scope, definition, inputs, owners, records } = parsed;
    if (typeof adapter !== 'string' || typeof fingerprint !== 'string' || typeof scope !== 'string')
        return undefined;
    if (!isRecord(definition) || typeof definition.name !== 'string' || typeof definition.version !== 'string')
        return undefined;
    if (!isStrings(inputs) || !inputs.every((kind) => INPUT_KINDS.includes(kind)))
        return undefined;
    if (!isRecord(owners) || !Object.values(owners).every(isStrings))
        return undefined;
    if (!isRecord(records))
        return undefined;
    const entries = emptyRecords();
    for (const kind of INPUT_KINDS) {
        const held = records[kind] ?? {};
        if (!isRecord(held))
            return undefined;
        for (const [id, entry] of Object.entries(held)) {
            if (!isRecord(entry) || typeof entry.revision !== 'string')
                return undefined;
            if (entry.owner !== undefined && typeof entry.owner !== 'string')
                return undefined;
            entries[kind][id] = { revision: entry.revision, ...(entry.owner !== undefined ? { owner: entry.owner } : {}) };
        }
    }
    return {
        version: ADAPTER_MANIFEST_VERSION,
        adapter,
        fingerprint,
        scope,
        definition: { name: definition.name, version: definition.version },
        inputs: inputs,
        // Recomputed rather than trusted, so it always identifies the records read.
        checkpoint: checkpointOf(entries),
        owners: owners,
        records: entries
    };
};
export const readAdapterManifest = async (stateRoot, adapter) => {
    try {
        return parseAdapterManifest(await readFile(adapterManifestPath(stateRoot, adapter), 'utf8'));
    }
    catch {
        return undefined;
    }
};
/** Every instance manifest on disk, by the instance id its file is named for. */
export const listAdapterManifests = async (stateRoot) => {
    try {
        return (await readdir(manifestsDir(stateRoot)))
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -'.json'.length))
            .sort();
    }
    catch {
        return [];
    }
};
/** Keys sorted throughout, so identical records give identical bytes (spec §72). */
export const writeAdapterManifest = async (stateRoot, manifest) => {
    const sorted = JSON.parse(stableStringify({ ...manifest, checkpoint: checkpointOf(manifest.records) }));
    await writeFileAtomic(adapterManifestPath(stateRoot, manifest.adapter), `${JSON.stringify(sorted, null, 2)}\n`);
};
export const removeAdapterManifest = (stateRoot, adapter) => rm(adapterManifestPath(stateRoot, adapter), { force: true });
