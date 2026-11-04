import { DEFAULT_CLOUD_URL } from '@docket/adapter-kit'

import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'

/** The module a `cloud` adapter instance names, which `docket cloud link` writes. */
export const CLOUD_ADAPTER_MODULE = '@docket/adapter-cloud'

/** The instance id `docket cloud link` gives the cloud adapter. */
export const CLOUD_ADAPTER_ID = 'cloud'

/** `acme/platform`: an org and one of its workspaces, as the cloud's URLs name them. */
export const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/

/** A project's link to a cloud workspace: its `cloud` adapter instance. */
export interface CloudLink {
  /** The adapter instance id. */
  id: string
  url: string
  org: string
  workspace: string
  tokenEnv?: string
}

export const parseWorkspace = (value: string): { org: string; workspace: string } => {
  if (!WORKSPACE_PATTERN.test(value)) {
    throw new Error(`"${value}" is not <org>/<workspace>: give it as the cloud's URLs do, e.g. acme/platform.`)
  }
  const [org, workspace] = value.split('/') as [string, string]
  return { org, workspace }
}

/** The project's cloud link, when it has one: its first adapter instance of the cloud module. */
export const cloudLinkOf = (resolved: ResolvedConfig): CloudLink | undefined => {
  const entry = resolved.config.adapters.find((adapter) => adapter.module === CLOUD_ADAPTER_MODULE)
  if (entry === undefined) return undefined
  const config = (entry.config ?? {}) as { url?: unknown; workspace?: unknown; tokenEnv?: unknown }
  if (typeof config.workspace !== 'string') {
    throw new Error(`Adapter "${entry.id}" (${CLOUD_ADAPTER_MODULE}) has no workspace: run \`docket cloud link <org>/<workspace>\` again.`)
  }
  return {
    id: entry.id,
    url: typeof config.url === 'string' ? config.url : DEFAULT_CLOUD_URL,
    ...parseWorkspace(config.workspace),
    ...(typeof config.tokenEnv === 'string' ? { tokenEnv: config.tokenEnv } : {})
  }
}

/** The project at or above `cwd`, and its cloud link - which must exist. */
export const requireCloudLink = async (cwd: string): Promise<{ resolved: ResolvedConfig; link: CloudLink }> => {
  const resolved = await loadConfig(cwd)
  const link = cloudLinkOf(resolved)
  if (link === undefined) {
    throw new Error(`${resolved.projectRoot} is not linked to a cloud workspace. Run \`docket cloud link <org>/<workspace>\` first.`)
  }
  return { resolved, link }
}
