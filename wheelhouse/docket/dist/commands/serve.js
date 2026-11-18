import { resolveAdapterModule } from '../adapters/resolve-module.js';
/*
 * `docket serve`: a self-hosted, single-tenant Docket server - Docket's
 * whole MCP surface for several people and agents at once, over a project's
 * own files by default or a Postgres database - is built on
 * `@chrisjowen/docket-server`, which builds on docket. docket loads it only
 * when serving, from beside itself, so every other command runs without it.
 */
/** The package `docket serve` runs on. */
export const SERVER_PACKAGE = '@chrisjowen/docket-server';
/**
 * `@chrisjowen/docket-server/serve`: installed beside docket (globally, or in
 * the project docket runs from), else in the project at or above `cwd`; or
 * an error saying how to install it.
 */
export const loadServeModule = async (cwd = process.cwd()) => {
    const specifier = `${SERVER_PACKAGE}/serve`;
    try {
        return (await import(specifier));
    }
    catch (cause) {
        const code = cause.code;
        if ((code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') && String(cause.message).includes(SERVER_PACKAGE)) {
            let local;
            try {
                const resolved = resolveAdapterModule(specifier, { id: 'serve', projectRoot: cwd });
                local = resolved.kind === 'package' ? resolved.url : undefined;
            }
            catch {
                local = undefined;
            }
            if (local)
                return (await import(local));
            throw new Error(`docket serve runs on ${SERVER_PACKAGE}, which is not installed beside docket. ` +
                `Install it where docket is: npm install -g ${SERVER_PACKAGE} (or npm install ${SERVER_PACKAGE} in this project). ` +
                'For a Postgres database, install pg too.');
        }
        throw cause;
    }
};
export const SERVE_ROLES = ['owner', 'admin', 'editor', 'viewer'];
