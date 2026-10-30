import { loadConfig } from '../config/loader.js';
import { composeRuntime } from '../runtime/docker-compose.js';
import { spawnRunner } from '../runtime/runner.js';
/** The adapter instances whose `runtime:` names this group. */
const adaptersUsing = (resolved, id) => resolved.config.adapters.flatMap((adapter) => (adapter.runtime === id ? [adapter.id] : []));
/** The configured runtime group `id`, ready to act on. Only the runtime commands open one. */
const openRuntime = async (id, options) => {
    const resolved = await loadConfig(options.cwd);
    const config = Object.hasOwn(resolved.config.runtimes, id) ? resolved.config.runtimes[id] : undefined;
    if (config === undefined) {
        const configured = Object.keys(resolved.config.runtimes).sort();
        throw new Error(`No runtime "${id}" in ${resolved.projectRoot}/.docket.yaml. ` +
            (configured.length > 0
                ? `Configured runtimes: ${configured.join(', ')}.`
                : 'It has no runtimes section; a connection to an existing service needs none.'));
    }
    return composeRuntime({
        id,
        config,
        projectRoot: resolved.projectRoot,
        adapters: adaptersUsing(resolved, id),
        runner: options.runner ?? spawnRunner
    });
};
/** `docket runtime plan <id>`: validate and describe what `up`, `status` and `down` would run. Starts nothing. */
export const runtimePlan = async (id, options = {}) => (await openRuntime(id, options)).plan();
/** `docket runtime up <id>`: start the selected services, pulling only as `pullPolicy` allows. */
export const runtimeUp = async (id, options = {}) => (await openRuntime(id, options)).up();
/** `docket runtime status <id>`: report state and health without changing anything. */
export const runtimeStatus = async (id, options = {}) => (await openRuntime(id, options)).status();
/** `docket runtime down <id>`: stop the selected services, keeping their volumes unless `destroyVolumes`. */
export const runtimeDown = async (id, options = {}) => (await openRuntime(id, options)).down({ destroyVolumes: options.destroyVolumes });
