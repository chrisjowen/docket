import { DEFAULT_SCOPE, openDocket } from '../adapters/docket.js';
import { ProjectionManager } from '../projection/manager.js';
import { recordSync } from '../sync/history.js';
import { canonicalState } from '../sync/inputs.js';
import { validate } from './validate.js';
/**
 * Some adapter instances failed to sync. The others synced and recorded what
 * they hold regardless; `result` says what each one did.
 */
export class SyncError extends AggregateError {
    result;
    constructor(result) {
        const failing = result.adapters.filter(failed);
        super(failing.map((report) => new Error(`${report.id}: ${failureOf(report)}`)), `sync failed for ${failing.map((report) => report.id).join(', ')}`);
        this.result = result;
        this.name = 'SyncError';
    }
}
const failed = (report) => report.error !== undefined || report.failed.length > 0;
/** One line saying why an instance did not fully sync. */
export const failureOf = (report) => {
    if (report.error !== undefined)
        return report.error;
    const shown = report.failed.slice(0, 3).map((failure) => `${failure.kind} ${failure.id}: ${failure.message}`);
    const more = report.failed.length > shown.length ? `; and ${report.failed.length - shown.length} more` : '';
    return `${report.failed.length} change${report.failed.length === 1 ? '' : 's'} failed - ${shown.join('; ')}${more}`;
};
/**
 * Projects `state` into every instance `manager` drives and writes their
 * manifests: what `sync` does once the files are read and checked.
 */
const project = async (manager, state, entities, broken, progress) => {
    try {
        progress({ stage: 'projecting', adapters: manager.ids });
        await manager.apply(state, broken, undefined, (report) => progress({ stage: 'synced', report }));
        progress({ stage: 'recording' });
        await manager.commit();
    }
    finally {
        await manager.close();
    }
    const adapters = manager.reports();
    const upserted = new Set(adapters.flatMap((report) => report.upserted.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)));
    const removed = new Set(adapters.flatMap((report) => report.removed.filter((ref) => ref.kind === 'entity').map((ref) => ref.id)));
    const held = new Set(adapters.flatMap((report) => report.held));
    return {
        upserted: entities.map((entity) => entity.id).filter((id) => upserted.has(id)),
        removed: [...removed].sort(),
        unchanged: entities.filter((entity) => !upserted.has(entity.id) && !held.has(entity.id)).length,
        adapters
    };
};
/**
 * The shared body of `sync` and `rebuild` - the two differ only in whether an
 * instance starts from its manifest or from nothing (spec §38, §39).
 *
 * Each adapter instance is planned against its own manifest and handed only
 * the input kinds it declares: entities, the observations their evidence
 * records, and their files' bodies as documents (docs/adapter-spec.md §8).
 */
export const reconcile = async (options) => {
    const progress = options.onProgress ?? (() => undefined);
    progress({ stage: 'validating' });
    const { resolved, entities, documents, broken, ontology, diagnostics } = await validate(options);
    const result = { diagnostics, upserted: [], removed: [], unchanged: 0, adapters: [] };
    // Without a registered ontology nothing can be judged valid, so project
    // nothing rather than indexing documents of unknown standing.
    if (ontology === null)
        return result;
    const docket = await openDocket(resolved);
    const manager = await ProjectionManager.forDocket(docket, { only: options.adapters, fresh: options.fresh });
    Object.assign(result, await project(manager, canonicalState(entities, documents, DEFAULT_SCOPE), entities, broken, progress));
    await recordSync(resolved, result.adapters.filter((report) => !failed(report)).map((report) => report.id));
    if (result.adapters.some(failed))
        throw new SyncError(result);
    return result;
};
/** One incremental reconciliation pass over the whole repository (spec §38). */
export const sync = (options = {}) => reconcile({ ...options, fresh: false });
/**
 * `docket sync` over a host's own storage: validates `source` as `validate`
 * does, then brings each instance up to it against its manifest in
 * `manifests` - planned, batched, retried and recorded exactly as the CLI
 * syncs a project, so a host never runs a second sync of its own. Instances
 * run independently: one that fails is reported in `SyncError.result`
 * while the others sync and record what they hold. Nothing is written but
 * the instances and their manifests.
 */
export const syncSource = async (source, manifests, adapters, options = {}) => {
    const ids = adapters.map((adapter) => adapter.id);
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    if (repeated !== undefined)
        throw new Error(`Adapter id "${repeated}" is used more than once; instance ids must be unique.`);
    const progress = options.onProgress ?? (() => undefined);
    progress({ stage: 'validating' });
    const { entities, documents, broken, ontology, diagnostics } = await validate({ source, strict: options.strict });
    const result = { diagnostics, upserted: [], removed: [], unchanged: 0, adapters: [] };
    // As `sync`: without a registered ontology nothing can be judged valid, so nothing is projected.
    if (ontology === null)
        return result;
    const scope = options.scope ?? DEFAULT_SCOPE;
    const slots = adapters.map((adapter) => ({
        id: adapter.id,
        name: adapter.id,
        source: 'registration',
        roles: ['projection'],
        fingerprint: adapter.fingerprint,
        scope,
        create: () => adapter.create()
    }));
    const fresh = options.fresh === true ? new Set(ids) : options.fresh === false ? undefined : options.fresh;
    const manager = await ProjectionManager.open(slots, { resolved: source.resolved, store: manifests, configured: ids, fresh });
    Object.assign(result, await project(manager, canonicalState(entities, documents, scope), entities, broken, progress));
    if (result.adapters.some(failed))
        throw new SyncError(result);
    return result;
};
