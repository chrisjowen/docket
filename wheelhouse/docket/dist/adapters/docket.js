import { join } from 'node:path';
import { ContractError, validateAdapterAnswer, validateAdapterDefinition, validateAdapterDescription, validateAdapterStatus, validateApplyReceipt, validateMemoryAdapter } from '../bundled/contracts/dist/index.js';
import { stableStringify } from '../bundled/adapter-kit/dist/index.js';
import { ADAPTER_ID_PATTERN, ADAPTER_ROLES, stateRootOf, V1_PROJECTION_MODULES } from '../config/config.js';
import { loadConfig } from '../config/loader.js';
import { validate } from '../commands/validate.js';
import { hashContent } from '../source/hashing.js';
import { canonicalState } from '../sync/inputs.js';
import { standardDistribution } from './distribution.js';
import { loadAdapterDefinition } from './loader.js';
/**
 * The Docket scope everything runs in. v1 configuration has no scope of its
 * own: each engine keeps the native scoping its own config sets.
 */
export const DEFAULT_SCOPE = 'default';
const ALL_ROLES = ADAPTER_ROLES;
/** The standard adapters' configs name their own type, so they identify their module. */
const STANDARD_MODULES = new Set(Object.values(V1_PROJECTION_MODULES));
/**
 * Opens the project's docket: the adapter instances its `.docket.yaml`
 * configures (a v1 file's projections converted to them), then any adapters
 * loaded by module reference or registered directly - all driven through the
 * adapter contract (docs/adapter-spec.md §4, §5, §12, §15).
 */
export const createDocket = async (options = {}) => openDocket(await loadConfig(options.projectRoot), options);
/** `createDocket` for a config already loaded. */
export const openDocket = async (resolved, options = {}) => {
    const load = (id, module) => loadAdapterDefinition(module, {
        id,
        projectRoot: resolved.projectRoot,
        typescript: options.typescript,
        distribution: options.distribution ?? standardDistribution
    });
    const pending = [];
    // The runtime reference is the docket's, not the adapter's (adapter spec §6).
    for (const { id, module, roles, config } of resolved.config.adapters) {
        pending.push({ id, source: module, definition: await load(id, module), config, roles, configured: module });
    }
    for (const reference of options.adapters ?? []) {
        checkId(reference.id);
        pending.push({
            id: reference.id,
            source: reference.module,
            definition: await load(reference.id, reference.module),
            config: reference.config,
            roles: reference.roles
        });
    }
    for (const registration of options.registrations ?? []) {
        pending.push({ ...registration, config: registration.config, source: 'registration' });
    }
    const ids = new Set();
    const canonical = options.canonical ?? projectCanonicalReader(resolved);
    const fingerprinted = [];
    const adapters = pending.map((entry) => {
        checkId(entry.id);
        if (ids.has(entry.id))
            throw new Error(`Adapter id "${entry.id}" is used more than once; instance ids must be unique.`);
        ids.add(entry.id);
        const definition = validateAdapterDefinition(entry.definition, `Adapter "${entry.id}"`);
        let config;
        try {
            config = definition.validateConfig(entry.config);
        }
        catch (cause) {
            throw new Error(`Adapter "${entry.id}" (${definition.name}) rejected its configuration: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        }
        const roles = entry.roles ?? ALL_ROLES;
        for (const role of roles) {
            if (!ALL_ROLES.includes(role))
                throw new Error(`Adapter "${entry.id}" has unknown role "${String(role)}".`);
        }
        if (entry.configured !== undefined && roles.includes('projection')) {
            fingerprinted.push(STANDARD_MODULES.has(entry.configured) ? config : { id: entry.id, module: entry.configured, config });
        }
        const services = {
            projectRoot: resolved.projectRoot,
            stateRoot: join(stateRootOf(resolved), 'adapters', entry.id),
            scope: DEFAULT_SCOPE,
            logger: stderrLogger(entry.id),
            canonical,
            secrets: { getEnv: async (name) => process.env[name] }
        };
        return {
            id: entry.id,
            name: definition.name,
            source: entry.source,
            roles: [...roles],
            fingerprint: hashContent(stableStringify({
                // A bundled adapter keeps nothing under its state root, so a renamed
                // instance still writes where it did; any other module's state root
                // moves with its id.
                ...(STANDARD_MODULES.has(entry.source) ? {} : { id: entry.id }),
                module: entry.source,
                definition: definition.name,
                config,
                scope: services.scope
            })),
            scope: services.scope,
            create: async () => guard(entry.id, roles, validateMemoryAdapter(await definition.create(config, services)))
        };
    });
    return {
        resolved,
        adapters,
        projectionsFingerprint: hashContent(stableStringify(fingerprinted)),
        // Loaded on first use: the coordinator itself opens dockets.
        ask: async (input) => (await (await import('../query/ask.js')).askProject(resolved.projectRoot, input, options)).answer
    };
};
const checkId = (id) => {
    if (typeof id !== 'string' || !ADAPTER_ID_PATTERN.test(id)) {
        throw new Error(`Adapter id "${String(id)}" must start with a letter or digit and use only letters, digits, ".", "_", "#" and "-".`);
    }
};
/** Warnings and errors reach stderr, attributed; debug and info stay quiet. */
const stderrLogger = (id) => {
    const write = (message) => console.error(`docket adapter ${id}: ${message}`);
    return { debug: () => { }, info: () => { }, warn: write, error: write };
};
/**
 * The project's canonical inputs - entities, the observations their evidence
 * records and their files' bodies as documents - read on first use, exactly
 * as sync derives them.
 */
const projectCanonicalReader = (resolved) => {
    let inputs;
    const load = () => {
        inputs ??= validate({ cwd: resolved.projectRoot }).then(({ entities, documents }) => canonicalState(entities, documents, DEFAULT_SCOPE).inputs.map(({ input }) => input));
        return inputs;
    };
    return {
        get: async (kind, id) => (await load()).find((record) => record.kind === kind && record.id === id),
        list: async (kind) => (await load()).filter((record) => record.kind === kind)
    };
};
/** Rethrows a broken contract as this instance's, so the error says which adapter broke it. */
const attributed = (id, run) => {
    try {
        return run();
    }
    catch (cause) {
        if (cause instanceof ContractError) {
            throw new ContractError(`Adapter "${id}" broke its contract - ${cause.summary}`, cause.issues);
        }
        throw cause;
    }
};
/** Validates everything the adapter returns, and leaves out the ports of roles it is not enabled for. */
const guard = (id, roles, adapter) => {
    const { projection, query } = adapter;
    return {
        describe: () => attributed(id, () => validateAdapterDescription(adapter.describe())),
        status: async (signal) => {
            const status = await adapter.status(signal);
            return attributed(id, () => validateAdapterStatus(status));
        },
        ...(projection && roles.includes('projection')
            ? {
                projection: {
                    apply: async (batch, signal) => {
                        const receipt = await projection.apply(batch, signal);
                        return attributed(id, () => validateApplyReceipt(receipt, batch));
                    },
                    ...(projection.flush ? { flush: (signal) => projection.flush(signal) } : {}),
                    reset: (scope, signal) => projection.reset(scope, signal)
                }
            }
            : {}),
        ...(query && roles.includes('query')
            ? {
                query: {
                    ask: async (request) => {
                        const answer = await query.ask(request);
                        return attributed(id, () => validateAdapterAnswer(answer, request));
                    }
                }
            }
            : {}),
        close: () => adapter.close()
    };
};
