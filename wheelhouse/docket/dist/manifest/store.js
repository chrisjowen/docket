import { listAdapterManifests, readAdapterManifest, removeAdapterManifest, writeAdapterManifest } from './adapter-manifest.js';
/** The manifests as files: `<state root>/manifests/<instance id>.json`, in the bytes sync has always written. */
export const fileManifestStore = (stateRoot) => ({
    read: (instanceId) => readAdapterManifest(stateRoot, instanceId),
    write: (instanceId, manifest) => writeAdapterManifest(stateRoot, { ...manifest, adapter: instanceId }),
    list: () => listAdapterManifests(stateRoot),
    remove: (instanceId) => removeAdapterManifest(stateRoot, instanceId)
});
