import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import type { KeepIndexOptions } from '../open/keep-index.js'
import { defaultUiDir, startUiServer, type UiServer } from '../open/server.js'

export interface OpenOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Exact port. Omitted: 4380 when free, else any free port. */
  port?: number | undefined
  /** Interface to listen on. Omitted: 127.0.0.1, this machine only. `0.0.0.0` is every interface. */
  host?: string | undefined
  /** The built web UI. Defaults to the copy shipped in this package. */
  uiDir?: string | undefined
  /** Other pages on this machine that may use the API, such as Wheelhouse's: http(s) origins on loopback. */
  allowOrigins?: readonly string[] | undefined
  /** Keep the projections current: sync the ones missing or behind the files now, and whenever the files change. */
  watch?: boolean | KeepIndexOptions | undefined
}

export interface OpenHandle extends UiServer {
  resolved: ResolvedConfig
}

/**
 * Serve the web UI for this repository - on loopback unless `host` names
 * another interface. Long-running: the
 * returned handle is the only way it stops. It never writes a canonical file;
 * it touches the projections only to search them, to sync them when the
 * page on this machine asks, and, with `watch`, to keep them current.
 */
export const open = async (options: OpenOptions = {}): Promise<OpenHandle> => {
  // Fail before listening when there is nothing to show.
  const resolved = await loadConfig(options.cwd)
  const uiDir = options.uiDir ?? defaultUiDir()
  if (!existsSync(join(uiDir, 'index.html'))) {
    throw new Error(
      `The web UI is missing from ${uiDir}: this docket build was made without it. ` +
        'Build the workspace with `pnpm build` at the repository root.'
    )
  }

  const server = await startUiServer({
    cwd: resolved.projectRoot,
    uiDir,
    port: options.port,
    host: options.host,
    allowOrigins: options.allowOrigins,
    watch: options.watch
  })
  return { ...server, resolved }
}
