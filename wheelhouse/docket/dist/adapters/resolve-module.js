import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const COMPILED_EXTENSIONS = new Set(['.js', '.mjs']);
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const isPathReference = (specifier) => specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier);
/**
 * Where an adapter module reference points (docs/adapter-spec.md §4): a
 * compiled `.js`/`.mjs` file relative to `.docket.yaml`, a `.ts` file when a
 * runner is configured, or an npm package installed in the project - or, for
 * the adapters docket ships with, docket's own copy. Never installs anything:
 * a missing module is an error that says how to fix it.
 */
export const resolveAdapterModule = (specifier, context) => {
    const label = `Adapter "${context.id}" module "${specifier}"`;
    if (isPathReference(specifier)) {
        const path = resolve(context.projectRoot, specifier);
        const extension = extname(path);
        if (TYPESCRIPT_EXTENSIONS.has(extension)) {
            if (context.typescript === undefined) {
                throw new Error(`${label} is TypeScript, and docket does not run TypeScript itself. ` +
                    'Compile it to .js or .mjs, or configure a TypeScript runner explicitly.');
            }
            if (!existsSync(path))
                throw notFound(label, path, context.projectRoot);
            return { kind: 'typescript', path };
        }
        if (!COMPILED_EXTENSIONS.has(extension)) {
            throw new Error(`${label} must be a compiled .js or .mjs file.`);
        }
        if (!existsSync(path))
            throw notFound(label, path, context.projectRoot);
        return { kind: 'file', path, url: pathToFileURL(path).href };
    }
    const { name, subpath } = splitPackageSpecifier(specifier);
    const packageDir = findPackageDir(name, context.projectRoot) ?? context.distribution?.find(name);
    if (packageDir === undefined) {
        if (context.distribution?.packages.includes(name)) {
            // docket's own adapter packages are not published: only a docket build ships them.
            const adapter = name.replace(/^@docket\/adapter-/, '');
            throw new Error(`${label} is not included in this build of docket. The standard @chrisjowen/docket CLI bundles the ` +
                `jsonl, neo4j and mem0 adapters; a docket build includes ${adapter} when DOCKET_BUNDLED_ADAPTERS is unset or lists it.`);
        }
        throw new Error(`${label} is not installed in ${context.projectRoot}. Install it in the project ` +
            `(e.g. \`npm install ${name}\`); docket never installs packages itself.`);
    }
    const entry = packageEntry(packageDir, subpath);
    if (entry === undefined) {
        throw new Error(`${label}: package "${name}" does not export "${subpath}" for import.`);
    }
    const path = resolve(packageDir, entry);
    if (!existsSync(path))
        throw new Error(`${label}: package "${name}" points at ${path}, which does not exist.`);
    return { kind: 'package', name, path, url: pathToFileURL(path).href };
};
const notFound = (label, path, projectRoot) => new Error(`${label} was not found at ${path}. Relative paths resolve against ${projectRoot}, the directory holding .docket.yaml.`);
/** `@scope/name/sub` → `@scope/name` and `./sub`; `name` → `name` and `.`. */
export const splitPackageSpecifier = (specifier) => {
    const parts = specifier.split('/');
    const length = specifier.startsWith('@') ? 2 : 1;
    const name = parts.slice(0, length).join('/');
    const rest = parts.slice(length);
    return { name, subpath: rest.length === 0 ? '.' : `./${rest.join('/')}` };
};
/** The package's directory in the nearest `node_modules` from `fromDir` upward - Node's own lookup order. */
export const findPackageDir = (name, fromDir) => {
    let dir = resolve(fromDir);
    for (;;) {
        const candidate = join(dir, 'node_modules', name);
        if (existsSync(join(candidate, 'package.json')))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
};
/** The file `import` would load for `subpath` of the package at `packageDir`, relative to it. */
const packageEntry = (packageDir, subpath) => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    if (manifest.exports !== undefined && manifest.exports !== null)
        return resolveExports(manifest.exports, subpath);
    if (subpath !== '.')
        return subpath;
    return typeof manifest.main === 'string' ? manifest.main : 'index.js';
};
/** The conditions an ESM `import` from Node matches, as Node itself does. */
const CONDITIONS = new Set(['node', 'import', 'default']);
const resolveTarget = (target, star) => {
    if (typeof target === 'string')
        return star === undefined ? target : target.replaceAll('*', star);
    if (Array.isArray(target)) {
        for (const candidate of target) {
            const resolved = resolveTarget(candidate, star);
            if (resolved !== undefined)
                return resolved;
        }
        return undefined;
    }
    if (typeof target === 'object' && target !== null) {
        // Object key order is the condition priority.
        for (const [condition, value] of Object.entries(target)) {
            if (!CONDITIONS.has(condition))
                continue;
            const resolved = resolveTarget(value, star);
            if (resolved !== undefined)
                return resolved;
        }
    }
    return undefined;
};
/** Resolves a package `exports` field for `subpath`, including single-`*` patterns. */
export const resolveExports = (exports, subpath) => {
    const isSubpathMap = typeof exports === 'object' && exports !== null && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith('.'));
    if (!isSubpathMap)
        return subpath === '.' ? resolveTarget(exports) : undefined;
    const map = exports;
    if (subpath in map)
        return resolveTarget(map[subpath]);
    let best;
    for (const key of Object.keys(map)) {
        const at = key.indexOf('*');
        if (at < 0)
            continue;
        const prefix = key.slice(0, at);
        const suffix = key.slice(at + 1);
        if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length)
            continue;
        if (best === undefined || prefix.length > best.prefix) {
            best = { key, star: subpath.slice(prefix.length, subpath.length - suffix.length), prefix: prefix.length };
        }
    }
    return best === undefined ? undefined : resolveTarget(map[best.key], best.star);
};
