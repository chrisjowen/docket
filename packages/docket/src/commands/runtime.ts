import { projectionInstanceIds } from '../adapters/docket.js'
import type { ResolvedConfig } from '../config/config.js'
import { loadConfig } from '../config/loader.js'
import {
  composeRuntime,
  type ComposeRuntime,
  type DownOptions,
  type RuntimeAction,
  type RuntimePlan,
  type RuntimeStatus
} from '../runtime/docker-compose.js'
import { spawnRunner, type CommandRunner } from '../runtime/runner.js'

export interface RuntimeCommandOptions {
  /** Where to look for `.docket.yaml`, walking up. Defaults to the working directory. */
  cwd?: string | undefined
  /** Runs the provider's commands. Defaults to spawning them. */
  runner?: CommandRunner | undefined
}

/** The adapter instances whose `runtime:` names this group. */
const adaptersUsing = (resolved: ResolvedConfig, id: string): string[] => {
  const ids = projectionInstanceIds(resolved.config.projections)
  return resolved.config.projections.flatMap((projection, index) => (projection.runtime === id ? [ids[index]!] : []))
}

/** The configured runtime group `id`, ready to act on. Only the runtime commands open one. */
const openRuntime = async (id: string, options: RuntimeCommandOptions): Promise<ComposeRuntime> => {
  const resolved = await loadConfig(options.cwd)
  const config = resolved.config.runtimes[id]
  if (config === undefined) {
    const configured = Object.keys(resolved.config.runtimes).sort()
    throw new Error(
      `No runtime "${id}" in ${resolved.projectRoot}/.docket.yaml. ` +
        (configured.length > 0
          ? `Configured runtimes: ${configured.join(', ')}.`
          : 'It has no runtimes section; a connection to an existing service needs none.')
    )
  }
  return composeRuntime({
    id,
    config,
    projectRoot: resolved.projectRoot,
    adapters: adaptersUsing(resolved, id),
    runner: options.runner ?? spawnRunner
  })
}

/** `docket runtime plan <id>`: validate and describe what `up`, `status` and `down` would run. Starts nothing. */
export const runtimePlan = async (id: string, options: RuntimeCommandOptions = {}): Promise<RuntimePlan> =>
  (await openRuntime(id, options)).plan()

/** `docket runtime up <id>`: start the selected services, pulling only as `pullPolicy` allows. */
export const runtimeUp = async (id: string, options: RuntimeCommandOptions = {}): Promise<RuntimeAction> =>
  (await openRuntime(id, options)).up()

/** `docket runtime status <id>`: report state and health without changing anything. */
export const runtimeStatus = async (id: string, options: RuntimeCommandOptions = {}): Promise<RuntimeStatus> =>
  (await openRuntime(id, options)).status()

/** `docket runtime down <id>`: stop the selected services, keeping their volumes unless `destroyVolumes`. */
export const runtimeDown = async (
  id: string,
  options: RuntimeCommandOptions & DownOptions = {}
): Promise<RuntimeAction> => (await openRuntime(id, options)).down({ destroyVolumes: options.destroyVolumes })
