import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { cloudOrigin, DEFAULT_CLOUD_URL, writeFileAtomic } from '@docket/adapter-kit'
import { parse } from 'yaml'

import { CLOUD_ADAPTER_ID, CLOUD_ADAPTER_MODULE, cloudLinkOf, parseWorkspace } from '../../cloud/project.js'
import { CONFIG_FILENAME } from '../../config/config.js'
import { findConfigFile, loadConfig } from '../../config/loader.js'
import { addToConfigText, type ConfigAddition } from '../../install/config-edit.js'

/** Environment variable names, as the other adapters take them. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface CloudLinkOptions {
  cwd?: string | undefined
  /** The cloud. Default: the beta host. */
  url?: string | undefined
  /** An environment variable holding an API token, for CI; unset, the signed-in session is used. */
  tokenEnv?: string | undefined
}

export interface CloudLinkResult {
  configFile: string
  entry: ConfigAddition['entry']
}

/**
 * Links the project to a cloud workspace: adds a query-only `cloud` adapter
 * instance to `.docket.yaml` through the config editor, which keeps every
 * other entry and comment and checks the file still loads. Nothing is asked
 * of the cloud: linking works offline.
 */
export const cloudLink = async (target: string, options: CloudLinkOptions = {}): Promise<CloudLinkResult> => {
  const { org, workspace } = parseWorkspace(target)
  const url = cloudOrigin(options.url ?? DEFAULT_CLOUD_URL)
  if (options.tokenEnv !== undefined && !ENV_NAME.test(options.tokenEnv)) {
    throw new Error(`--token-env must be an environment variable name, got "${options.tokenEnv}"`)
  }

  const start = resolve(options.cwd ?? process.cwd())
  const configFile = findConfigFile(start)
  if (configFile === undefined) {
    throw new Error(`No ${CONFIG_FILENAME} found in ${start} or any parent directory. Run \`docket init\` first.`)
  }
  const text = await readFile(configFile, 'utf8')
  if ((parse(text) as { version?: unknown } | null)?.version === 1) {
    throw new Error(
      `${configFile} is version 1, and the cloud link is a version 2 adapter entry. ` +
        'Migrate it first with `docket config migrate` (it keeps the original as a backup).'
    )
  }

  const existing = cloudLinkOf(await loadConfig(dirname(configFile)))
  if (existing !== undefined) {
    throw new Error(
      `${configFile} is already linked to ${existing.org}/${existing.workspace} on ${existing.url} (adapter "${existing.id}"). ` +
        'Remove that entry first to link another workspace.'
    )
  }

  const entry: ConfigAddition['entry'] = {
    id: CLOUD_ADAPTER_ID,
    module: CLOUD_ADAPTER_MODULE,
    roles: ['query'],
    config: { url, workspace: `${org}/${workspace}`, ...(options.tokenEnv === undefined ? {} : { tokenEnv: options.tokenEnv }) }
  }
  await writeFileAtomic(configFile, addToConfigText(text, { entry }, configFile))
  return { configFile, entry }
}
