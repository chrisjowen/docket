import { entryPaths } from './manifest.js';
export const manifestEntry = (entity) => ({
    path: entity.path,
    ...(entity.paths.length > 1 ? { paths: entity.paths } : {}),
    hash: entity.hash
});
/**
 * Decides what to hand the projections, given the entities as they stand and
 * what the manifest says was projected before.
 *
 * Spec §67: a file that is currently broken keeps its previous projection
 * rather than having it erased. With several files per id, that holds the
 * whole entity: an id any of whose previously projected files is broken keeps
 * its previous projection until the file is fixed, since merging without it
 * would erase what it contributed. `broken` is keyed by path because a file
 * that failed to parse never produced an id.
 */
export const planProjection = (entities, broken, previous) => {
    const held = new Set(Object.entries(previous)
        .filter(([, entry]) => entryPaths(entry).some((path) => broken.has(path)))
        .map(([id]) => id));
    const plan = { upserts: [], removals: [], unchanged: 0, next: {} };
    for (const entity of entities) {
        if (held.has(entity.id))
            continue;
        plan.next[entity.id] = manifestEntry(entity);
        // The hash covers the paths, so a moved file is reprojected too.
        if (previous[entity.id]?.hash === entity.hash)
            plan.unchanged += 1;
        else
            plan.upserts.push(entity);
    }
    for (const [id, entry] of Object.entries(previous)) {
        if (plan.next[id])
            continue;
        if (held.has(id))
            plan.next[id] = entry;
        else
            plan.removals.push(id);
    }
    return plan;
};
const REMOVAL_ORDER = ['document', 'observation', 'entity'];
/**
 * What to hand one adapter instance, given the canonical inputs as they stand
 * and its manifest - `planProjection` for one instance and every input kind.
 * An entity any of whose previously read files is broken holds every record
 * derived from it, so a half-saved file changes nothing until it is fixed.
 */
export const planAdapter = (state, manifest, options) => {
    const inScope = (owner) => options.scope === undefined || options.scope.has(owner);
    const held = new Set(Object.entries(manifest.owners)
        .filter(([owner, paths]) => inScope(owner) && paths.some((path) => options.broken.has(path)))
        .map(([owner]) => owner));
    const plannable = (owner) => inScope(owner) && !held.has(owner);
    const desired = new Map(REMOVAL_ORDER.map((kind) => [kind, new Map()]));
    const upserts = [];
    let unchanged = 0;
    for (const { input, owner } of state.inputs) {
        if (!options.inputs.has(input.kind) || !plannable(owner))
            continue;
        desired.get(input.kind)?.set(input.id, owner);
        const entry = manifest.records[input.kind][input.id];
        if (entry?.revision === input.revision && (entry.owner ?? input.id) === owner)
            unchanged += 1;
        else
            upserts.push({ change: { operation: 'upsert', record: input }, owner });
    }
    const removals = [];
    for (const kind of REMOVAL_ORDER) {
        if (!options.inputs.has(kind))
            continue;
        for (const [id, entry] of Object.entries(manifest.records[kind])) {
            const owner = entry.owner ?? id;
            if (!plannable(owner) || desired.get(kind)?.has(id))
                continue;
            removals.push({ change: { operation: 'remove', kind, id, revision: entry.revision }, owner });
        }
    }
    const owners = {};
    for (const [owner, paths] of Object.entries(manifest.owners)) {
        if (!plannable(owner))
            owners[owner] = paths;
    }
    for (const [owner, paths] of state.owners) {
        if (plannable(owner))
            owners[owner] = [...paths];
    }
    return { changes: [...removals, ...upserts], unchanged, held, owners };
};
