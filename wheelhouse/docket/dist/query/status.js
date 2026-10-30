import { openDocket } from '../adapters/docket.js';
import { freshnessOf } from './freshness.js';
import { takeSnapshot } from './snapshot.js';
/** How long one instance may take to say how it is. */
export const STATUS_TIMEOUT_MS = 10_000;
const messageOf = (cause) => (cause instanceof Error ? cause.message : String(cause));
/** Rejects with `message` once `ms` pass, aborting `controller` so the adapter can stop too. */
const within = (work, ms, controller, message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(message));
    }, ms);
    work.then((value) => {
        clearTimeout(timer);
        resolve(value);
    }, (error) => {
        clearTimeout(timer);
        reject(error);
    });
});
/** Creates the instance, asks it to describe itself and report its status, and closes it. */
const probe = async (slot, timeoutMs) => {
    const controller = new AbortController();
    const result = {};
    const created = slot.create();
    try {
        const adapter = await within(created, timeoutMs, controller, `${slot.id} did not start within ${timeoutMs / 1000}s`);
        try {
            try {
                result.description = adapter.describe();
            }
            catch (cause) {
                result.statusError = messageOf(cause);
            }
            result.status = await within(adapter.status(controller.signal), timeoutMs, controller, `${slot.id} did not report its status within ${timeoutMs / 1000}s`);
        }
        finally {
            await adapter.close().catch(() => undefined);
        }
    }
    catch (cause) {
        result.statusError = [result.statusError, messageOf(cause)].filter(Boolean).join(' ');
        // One that started after giving up is closed as soon as it does.
        void created.then((adapter) => adapter.close()).catch(() => undefined);
    }
    return result;
};
/**
 * Every configured adapter instance (docs/adapter-spec.md §13, §14): its
 * module, roles and runtime reference, how it describes itself, the status it
 * reports and - worked out by docket from the files and its sync manifest -
 * how far its index lags them. Never its configuration, which can hold
 * secrets. Reading status connects to each instance but never starts a
 * container or pulls an image; an instance that cannot be loaded or reached
 * says why, beside the others.
 */
export const adaptersStatus = async (cwd, options = {}) => {
    const snapshot = await takeSnapshot(cwd);
    const { config } = snapshot.resolved;
    const runtimes = new Map(config.adapters.flatMap((adapter) => (adapter.runtime === undefined ? [] : [[adapter.id, adapter.runtime]])));
    const query = (ids) => ({ defaultAdapters: config.query.defaultAdapters ?? ids, synthesis: config.query.synthesis });
    let docket;
    try {
        docket = await openDocket(snapshot.resolved, { canonical: snapshot.reader });
    }
    catch (cause) {
        // One module that cannot load stops the docket opening: still list every instance, saying why.
        const message = messageOf(cause);
        const adapters = config.adapters.map((adapter) => ({
            id: adapter.id,
            module: adapter.module,
            roles: [...adapter.roles],
            statusError: message,
            freshness: { state: 'unknown' },
            ...(adapter.runtime !== undefined ? { runtime: adapter.runtime } : {})
        }));
        return {
            adapters,
            query: query(config.adapters.filter((adapter) => adapter.roles.includes('query')).map((adapter) => adapter.id)),
            diagnostics: [{ severity: 'error', code: 'adapters-not-loaded', message }]
        };
    }
    const timeoutMs = options.timeoutMs ?? Math.min(STATUS_TIMEOUT_MS, config.query.timeoutMs);
    const probes = await Promise.all(docket.adapters.map((slot) => probe(slot, timeoutMs)));
    const inputs = new Map();
    const reported = new Map();
    docket.adapters.forEach((slot, index) => {
        const found = probes[index];
        if (found?.description)
            inputs.set(slot.id, found.description.inputs);
        if (found?.status)
            reported.set(slot.id, found.status.checkpoint);
    });
    const freshness = await freshnessOf(docket, snapshot, docket.adapters, { inputs, reported });
    const diagnostics = [];
    if (snapshot.broken.size > 0) {
        diagnostics.push({
            severity: 'warning',
            code: 'broken-files',
            message: `${snapshot.broken.size === 1 ? '1 file has' : `${snapshot.broken.size} files have`} errors; adapters keep what those files last projected until they are fixed. Run \`docket validate\`.`
        });
    }
    return {
        adapters: docket.adapters.map((slot, index) => {
            const found = probes[index] ?? {};
            const runtime = runtimes.get(slot.id);
            const fresh = freshness.get(slot.id);
            return {
                id: slot.id,
                module: slot.source,
                roles: [...slot.roles],
                ...(found.description ? { description: found.description } : {}),
                ...(found.status ? { status: found.status } : {}),
                ...(found.statusError ? { statusError: found.statusError } : {}),
                ...(fresh ? { freshness: fresh } : {}),
                ...(runtime !== undefined ? { runtime } : {})
            };
        }),
        query: query(docket.adapters.filter((slot) => slot.roles.includes('query')).map((slot) => slot.id)),
        diagnostics
    };
};
