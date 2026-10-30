import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { writeFileAtomic } from '../bundled/adapter-kit/dist/index.js';
import { parse } from '../vendor/yaml.js';
import { openDocket } from '../adapters/docket.js';
import { standardDistribution } from '../adapters/distribution.js';
import { findPackageDir, resolveAdapterModule } from '../adapters/resolve-module.js';
import { ADAPTER_ID_PATTERN, ADAPTER_ROLES, CONFIG_FILENAME } from '../config/config.js';
import { findConfigFile, loadConfig } from '../config/loader.js';
import { spawnRunner } from '../runtime/runner.js';
import { Answers, uniqueId } from '../install/answers.js';
import { addToConfigText, additionYaml } from '../install/config-edit.js';
import { detectPackageManager, driverSpec, installCommand } from '../install/packages.js';
import { findProvider, PROVIDERS } from '../install/providers.js';
import { configMigrate } from './config.js';
import { runtimePlan } from './runtime.js';
const ROLE_CHOICES = [
    { value: 'projection,query', label: 'projection and query - sync into it and ask it questions' },
    { value: 'query', label: 'query only - ask it, never sync into it' },
    { value: 'projection', label: 'projection only - sync into it, never ask it' }
];
/** `--roles query,projection` in any order and spacing, as the choice it means. */
const normalizeRoles = (value) => {
    if (value === undefined)
        return undefined;
    const roles = value.split(',').map((role) => role.trim()).filter(Boolean);
    const known = ADAPTER_ROLES.filter((role) => roles.includes(role));
    return known.length === roles.length && new Set(roles).size === roles.length ? known.join(',') : value;
};
const CHECK_TIMEOUT_MS = 15_000;
/**
 * Opens one configured adapter as sync would - connecting, and preparing what
 * it prepares - and asks its status. Only this instance is loaded.
 */
const checkAdapter = async (resolved, id) => {
    const entry = resolved.config.adapters.find((adapter) => adapter.id === id);
    if (entry === undefined)
        throw new Error(`No adapter "${id}" in ${CONFIG_FILENAME}.`);
    const docket = await openDocket({ ...resolved, config: { ...resolved.config, adapters: [entry] } });
    const slot = docket.adapters[0];
    let timer;
    const timeout = new Promise((_, fail) => {
        timer = setTimeout(() => fail(new Error(`no answer within ${CHECK_TIMEOUT_MS / 1000}s`)), CHECK_TIMEOUT_MS);
    });
    try {
        const adapter = await Promise.race([slot.create(), timeout]);
        try {
            return await Promise.race([adapter.status(AbortSignal.timeout(CHECK_TIMEOUT_MS)), timeout]);
        }
        finally {
            await adapter.close();
        }
    }
    finally {
        clearTimeout(timer);
    }
};
const settle = async (run) => {
    try {
        return { ok: true, value: await run() };
    }
    catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
};
/**
 * The command a developer types: one argument, quoted for a POSIX shell when
 * it needs to be. Only for display - the installer runs commands without a shell.
 */
const quote = (arg) => (/^[A-Za-z0-9_./:@=,+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);
export const displayCommand = (argv) => argv.map(quote).join(' ');
/**
 * `docket adapter add <provider>` (docs/adapter-spec.md §5, §6): asks what an
 * adapter instance needs - or reads it from options - and resolves the whole
 * change into a plan: the `.docket.yaml` entry, any runtime group and Compose
 * template, the environment variables to set, the driver package and the
 * commands to run next. It applies the plan only when confirmed or told to.
 *
 * Guarantees: an existing file is never overwritten; a secret is only ever
 * named by its environment variable, never asked for or written; nothing is
 * installed without consent; no image is pulled and no container started.
 */
export const adapterAdd = async (provider, options = {}) => {
    const definition = findProvider(provider);
    if (definition === undefined) {
        throw new Error(`No provider "${provider}". \`docket adapter add\` sets up: ${PROVIDERS.map((p) => p.name).join(', ')}. ` +
            'A project-local adapter module is added to .docket.yaml by hand.');
    }
    const start = resolve(options.cwd ?? process.cwd());
    const configFile = findConfigFile(start);
    if (configFile === undefined) {
        throw new Error(`No ${CONFIG_FILENAME} found in ${start} or any parent directory. Run \`docket init\` first.`);
    }
    const projectRoot = dirname(configFile);
    const interactive = !options.yes && (options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
    if (interactive && options.prompter === undefined)
        throw new Error('An interactive adapter add needs a prompter.');
    const prompter = interactive ? options.prompter : undefined;
    // Adapter entries are version 2; a version 1 file is never migrated silently.
    let text = await readFile(configFile, 'utf8');
    const version = parse(text)?.version;
    if (version === 1) {
        const explain = `${configFile} is version 1, and adapter instances are version 2 entries. ` +
            'Migrate it first with `docket config migrate` (it shows the result and keeps the original as a backup; ' +
            'a version 1 file keeps working until you do).';
        if (prompter === undefined || options.dryRun)
            throw new Error(explain);
        prompter.note(explain);
        if (!(await prompter.confirm(`Migrate ${configFile} to version 2 now, keeping the original as a backup?`, false))) {
            throw new Error(explain);
        }
        const migrated = await configMigrate({ cwd: projectRoot, write: true });
        if (migrated.status === 'written')
            prompter.note(`Migrated ${configFile}; the original is kept at ${migrated.backup}.`);
        text = await readFile(configFile, 'utf8');
    }
    const resolved = await loadConfig(projectRoot);
    const takenIds = new Set(resolved.config.adapters.map((adapter) => adapter.id));
    const values = { ...options.values, '--roles': normalizeRoles(options.values?.['--roles']) };
    const answers = new Answers(values, prompter);
    prompter?.note(`Adding a ${definition.name} adapter (${definition.summary}).`);
    const id = await answers.text({
        flag: '--id',
        question: 'Adapter instance id',
        fallback: uniqueId(definition.defaultId, takenIds),
        check: (value) => !ADAPTER_ID_PATTERN.test(value)
            ? 'starts with a letter or digit and uses only letters, digits, ".", "_", "#" and "-"'
            : takenIds.has(value)
                ? `adapter "${value}" is already in ${CONFIG_FILENAME}; choose another id`
                : undefined
    });
    const roles = (await answers.choose({
        flag: '--roles',
        question: 'What should it do?',
        choices: ROLE_CHOICES,
        fallback: 'projection,query'
    })).split(',');
    const setup = await definition.configure({
        answers,
        id,
        projectRoot,
        runtimes: new Set(Object.keys(resolved.config.runtimes))
    });
    const unused = answers.unused();
    if (unused.length > 0) {
        throw new Error(`${unused.join(', ')} ${unused.length === 1 ? 'does' : 'do'} not apply to a ${definition.name} adapter set up this way; leave ${unused.length === 1 ? 'it' : 'them'} out.`);
    }
    const addition = {
        entry: { id, module: definition.module, roles, ...(setup.runtime ? { runtime: setup.runtime.id } : {}), config: setup.config },
        runtime: setup.runtime
    };
    // Checked now, so a plan that is shown is one that can be applied.
    addToConfigText(text, addition, configFile);
    const files = setup.files.map((file) => {
        const absolute = isAbsolute(file.path) ? file.path : resolve(projectRoot, file.path);
        return { ...file, absolute, exists: existsSync(absolute) };
    });
    const driver = definition.driver === undefined ? undefined : planDriver(definition.driver, definition.module, projectRoot);
    const module = standardDistribution.packages.includes(definition.module)
        ? undefined
        : { name: definition.module, installed: findPackageDir(definition.module, projectRoot) !== undefined };
    const notes = [...setup.notes];
    for (const file of files.filter((file) => file.exists)) {
        notes.push(`${file.path} already exists and is kept as it is; check it defines the service "${setup.runtime?.config.services?.[0] ?? ''}" this runtime starts.`);
    }
    const defaults = resolved.config.query.defaultAdapters;
    if (defaults !== undefined && roles.includes('query')) {
        notes.push(`query.defaultAdapters lists ${defaults.join(', ')}; add ${id} there for questions to reach it by default.`);
    }
    const next = [];
    if (module !== undefined && !module.installed) {
        next.push(`Add ${module.name} to the project: it is not published to npm, so depend on a docket checkout's package (a workspace or file: dependency)`);
    }
    next.push(...setup.prerequisites);
    if (driver !== undefined && !driver.installed) {
        next.push(driver.command
            ? displayCommand(driver.command)
            : `Install ${driver.spec} where docket runs (there is no package.json in ${projectRoot})`);
    }
    for (const variable of setup.env.filter((variable) => variable.required)) {
        next.push(`export ${variable.name}=...   # ${variable.purpose}`);
    }
    if (setup.runtime) {
        next.push(`docket runtime plan ${setup.runtime.id}`, `docket runtime up ${setup.runtime.id}`, `docket runtime status ${setup.runtime.id}`);
    }
    next.push(roles.includes('projection') ? 'docket sync' : 'docket search <query>');
    const plan = {
        provider: definition.name,
        configFile,
        projectRoot,
        addition,
        configYaml: additionYaml(addition),
        files,
        env: setup.env,
        module,
        driver,
        prerequisites: setup.prerequisites,
        notes,
        next
    };
    options.show?.(plan);
    if (options.dryRun)
        return { status: 'preview', plan };
    if (!options.yes) {
        if (prompter === undefined) {
            throw new Error('Not changing anything without confirmation. Pass --yes to apply the plan, or --dry-run to only see it.');
        }
        if (!(await prompter.confirm('Apply this plan?', true)))
            return { status: 'declined', plan };
    }
    // Apply: templates first, each only where nothing exists, then the config.
    const created = [];
    const kept = [];
    for (const file of files) {
        if (file.exists) {
            kept.push(file.path);
            continue;
        }
        await mkdir(dirname(file.absolute), { recursive: true });
        try {
            await writeFile(file.absolute, file.contents, { encoding: 'utf8', flag: 'wx' });
            created.push(file.path);
        }
        catch (cause) {
            if (cause.code !== 'EEXIST')
                throw cause;
            kept.push(file.path);
        }
    }
    // Never overwrite an edit made to .docket.yaml since it was read.
    if ((await readFile(configFile, 'utf8')) !== text) {
        throw new Error(`${configFile} changed while the plan was being made; it is left as it is` +
            (created.length > 0 ? ` (created: ${created.join(', ')})` : '') +
            '. Run `docket adapter add` again.');
    }
    await writeFileAtomic(configFile, addToConfigText(text, addition, configFile));
    const runner = options.runner ?? spawnRunner;
    const result = { status: 'applied', plan, created, kept };
    if (driver?.command !== undefined && !driver.installed) {
        const consent = options.install ??
            (await answers.confirm(`Install ${driver.spec} into ${projectRoot} (${displayCommand(driver.command)})?`, false));
        if (consent) {
            const [command, ...args] = driver.command;
            result.install = await settle(async () => {
                const outcome = await runner({ command: command, args, cwd: projectRoot, stream: true });
                if (outcome.exitCode !== 0)
                    throw new Error(`${displayCommand(driver.command)} exited with ${outcome.exitCode}`);
                return displayCommand(driver.command);
            });
            if (result.install.ok)
                plan.next.splice(plan.next.indexOf(displayCommand(driver.command)), 1);
        }
    }
    if (setup.runtime) {
        const runtimeId = setup.runtime.id;
        const wanted = options.planRuntime ??
            (await answers.confirm(`Run \`docket runtime plan ${runtimeId}\` now? It checks the Compose file and starts nothing.`, false));
        if (wanted)
            result.runtimePlan = await settle(() => runtimePlan(runtimeId, { cwd: projectRoot, runner }));
    }
    const wantCheck = options.check ??
        (setup.runtime === undefined &&
            (await answers.confirm('Check the connection now? This opens the adapter as `docket sync` would.', false)));
    if (wantCheck)
        result.check = await settle(async () => checkAdapter(await loadConfig(projectRoot), id));
    return result;
};
/** Where an adapter package's own imports resolve from: the directory its module loads from, else the project. */
const moduleDir = (module, projectRoot) => {
    try {
        return dirname(resolveAdapterModule(module, { id: module, projectRoot, distribution: standardDistribution }).path);
    }
    catch {
        return projectRoot;
    }
};
const planDriver = (name, module, projectRoot) => {
    const spec = driverSpec(name);
    const installed = findPackageDir(name, moduleDir(module, projectRoot)) !== undefined;
    const manager = detectPackageManager(projectRoot);
    return {
        name,
        spec,
        installed,
        manager,
        command: manager === undefined ? undefined : installCommand(manager, spec, projectRoot)
    };
};
/**
 * `docket adapters list` (docs/adapter-spec.md §14): the configured adapter
 * instances, where each one's module would load from and whether its driver
 * is installed. Resolves modules without importing or connecting to anything.
 */
export const adaptersList = async (options = {}) => {
    const resolved = await loadConfig(options.cwd);
    const adapters = resolved.config.adapters.map((adapter) => {
        const listing = {
            id: adapter.id,
            module: adapter.module,
            roles: adapter.roles,
            ...(adapter.runtime === undefined ? {} : { runtime: adapter.runtime })
        };
        try {
            const module = resolveAdapterModule(adapter.module, {
                id: adapter.id,
                projectRoot: resolved.projectRoot,
                distribution: standardDistribution,
                // Resolution only: whether a runner is configured is the program's concern.
                typescript: async () => undefined
            });
            if (module.kind === 'file')
                listing.source = 'project file';
            else if (module.kind === 'typescript')
                listing.source = 'TypeScript file';
            else {
                const bundled = standardDistribution.find(module.name);
                const own = findPackageDir(module.name, resolved.projectRoot);
                listing.source = own === undefined && bundled !== undefined ? 'bundled' : 'installed package';
                const driver = PROVIDERS.find((provider) => provider.module === module.name)?.driver;
                if (driver !== undefined && findPackageDir(driver, dirname(module.path)) === undefined) {
                    listing.problem = `needs ${driver}: install it in the project (\`docket adapter add\` offers to), e.g. ${displayCommand(installCommand(detectPackageManager(resolved.projectRoot) ?? 'npm', driverSpec(driver), resolved.projectRoot))}`;
                }
            }
        }
        catch (cause) {
            const unpublished = !standardDistribution.packages.includes(adapter.module) && PROVIDERS.some((provider) => provider.module === adapter.module);
            listing.problem = unpublished
                ? `${adapter.module} is not installed in the project; it is not published to npm, so add it as a workspace or file: dependency on a docket checkout's package`
                : cause instanceof Error
                    ? cause.message
                    : String(cause);
        }
        return listing;
    });
    return {
        configFile: resolve(resolved.projectRoot, CONFIG_FILENAME),
        adapters,
        providers: PROVIDERS.map(({ name, summary }) => ({ name, summary }))
    };
};
