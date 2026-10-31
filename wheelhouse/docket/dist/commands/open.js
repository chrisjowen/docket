import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { defaultUiDir, startUiServer } from '../open/server.js';
/**
 * Serve the web UI for this repository - on loopback unless `host` names
 * another interface. Long-running: the
 * returned handle is the only way it stops. It never writes a canonical file;
 * it touches the projections only to search them, or to sync them when the
 * page on this machine asks.
 */
export const open = async (options = {}) => {
    // Fail before listening when there is nothing to show.
    const resolved = await loadConfig(options.cwd);
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
    return { ...server, resolved };
};
