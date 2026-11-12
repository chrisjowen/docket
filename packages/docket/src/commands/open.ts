import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { CONFIG_FILENAME, type ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { defaultUiDir, startUiServer, type UiServer } from '../open/server.js'
import { init, type InitResult } from './init.js'

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
  /**
   * Start a docket in `cwd` first, as `docket init` does, when it has no
   * `.docket.yaml` of its own; one in a parent directory does not count.
   */
  init?: boolean | undefined
}

export interface OpenHandle extends UiServer {
  resolved: ResolvedConfig
  /** What `init` created, when it started the docket; null when there already was one. */
  initialized: InitResult | null
}

/**
 * Serve the web UI for this repository - on loopback unless `host` names
 * another interface. Long-running: the
 * returned handle is the only way it stops. Apart from `init`, which starts
 * a docket first where there is none, it never writes a canonical file; it
 * touches the projections only to search them, or to sync them when the page
 * on this machine asks.
 */
export const open = async (options: OpenOptions = {}): Promise<OpenHandle> => {
  const cwd = resolve(options.cwd ?? process.cwd())
  const initialized = options.init && !existsSync(join(cwd, CONFIG_FILENAME)) ? await init({ cwd }) : null
  // Fail before listening when there is nothing to show.
  const resolved = await loadConfig(cwd)
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
    allowOrigins: options.allowOrigins
  })
  return { ...server, resolved, initialized }
}
