import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_FILENAME } from '../config/config.js';
import { loadConfig } from '../config/loader.js';
import { defaultUiDir, startUiServer } from '../open/server.js';
import { init } from './init.js';
/**
 * Serve the web UI for this repository - on loopback unless `host` names
 * another interface. Long-running: the
 * returned handle is the only way it stops. Apart from `init`, which starts
 * a docket first where there is none, it never writes a canonical file; it
 * touches the projections only to search them, or to sync them when the page
 * on this machine asks.
 */
export const open = async (options = {}) => {
    const cwd = resolve(options.cwd ?? process.cwd());
    const initialized = options.init && !existsSync(join(cwd, CONFIG_FILENAME)) ? await init({ cwd }) : null;
    // Fail before listening when there is nothing to show.
    const resolved = await loadConfig(cwd);
    const uiDir = options.uiDir ?? defaultUiDir();
    if (!existsSync(join(uiDir, 'index.html'))) {
        throw new Error(`The web UI is missing from ${uiDir}: this docket build was made without it. ` +
            'Build the workspace with `pnpm build` at the repository root.');
    }
    const server = await startUiServer({
        cwd: resolved.projectRoot,
        uiDir,
        port: options.port,
        host: options.host,
        allowOrigins: options.allowOrigins
    });
    return { ...server, resolved, initialized };
};
