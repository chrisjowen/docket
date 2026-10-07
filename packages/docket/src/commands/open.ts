import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import { defaultUiDir, startUiServer, type UiServer } from '../open/server.js'

export interface OpenOptions {
  /** Directory to resolve `.docket.yaml` from. Defaults to the working directory. */
  cwd?: string | undefined
  /** Exact port. Omitted: 4380 when free, else any free port. */
  port?: number | undefined
  /** The built web UI. Defaults to the copy shipped in this package. */
  uiDir?: string | undefined
}

export interface OpenHandle extends UiServer {
  resolved: ResolvedConfig
}

/**
 * Serve the web UI for this repository on every network interface. Long-running: the
 * returned handle is the only way it stops. Reads only - it never syncs,
 * writes a file or touches a projection beyond searching it.
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

  const server = await startUiServer({ cwd: resolved.projectRoot, uiDir, port: options.port })
  return { ...server, resolved }
}
