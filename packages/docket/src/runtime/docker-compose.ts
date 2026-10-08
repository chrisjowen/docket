import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { DockerComposeRuntimeConfig, PullPolicy } from './config.js'
import { CommandNotFoundError, type CommandOutcome, type CommandRunner } from './runner.js'

/** What `docket runtime` is given for one runtime group. */
export interface ComposeRuntimeContext {
  id: string
  config: DockerComposeRuntimeConfig
  /** The directory holding `.docket.yaml`; a relative `composeFile` resolves against it. */
  projectRoot: string
  /** Adapter instances whose `runtime:` names this group. Reported, never acted on. */
  adapters: readonly string[]
  runner: CommandRunner
}

/** One service as the plan shows it. Environment values are never included. */
export interface PlannedService {
  name: string
  /** Exactly as the Compose file resolves it - never replaced with another. */
  image?: string
  ports: string[]
  volumes: string[]
  /** Variable names only; their values are redacted. */
  environment: string[]
}

export interface RuntimeOperation {
  /** The command line, for display. It carries no secrets: paths, the project name and service names only. */
  command: string
  description: string
}

export interface RuntimePlan {
  runtime: string
  provider: 'docker-compose'
  composeFile: string
  projectName: string
  pullPolicy: PullPolicy
  /** The services acted on; empty means every service in the file. */
  services: string[]
  adapters: string[]
  /** What Compose resolves the selected services to. Empty when it could not resolve them. */
  resolved: PlannedService[]
  operations: { up: RuntimeOperation; status: RuntimeOperation; down: RuntimeOperation; destroyVolumes: RuntimeOperation }
  /** Why the runtime cannot be brought up as configured. A plan with problems fails. */
  problems: string[]
}

export interface ServiceStatus {
  service: string
  /** Compose's state (`running`, `exited`, ...), or `not created` when the service has no container. */
  state: string
  health?: string
  container?: string
  image?: string
  status?: string
}

export interface RuntimeStatus {
  runtime: string
  projectName: string
  services: ServiceStatus[]
}

export interface RuntimeAction {
  runtime: string
  command: string
}

export interface DownOptions {
  /**
   * Also remove the project's volumes, destroying the data in them. Only the
   * separately named `--destroy-volumes` option sets this; nothing else does.
   */
  destroyVolumes?: boolean | undefined
}

export interface ComposeRuntime {
  plan(): Promise<RuntimePlan>
  up(): Promise<RuntimeAction>
  status(): Promise<RuntimeStatus>
  down(options?: DownOptions): Promise<RuntimeAction>
}

const DOCKER = 'docker'

/** The label Compose puts on every container of a project, and the one naming its service. */
const PROJECT_LABEL = 'com.docker.compose.project'
const SERVICE_LABEL = 'com.docker.compose.service'

/** One tab-separated line per container: service, name, state, status, image. */
const STATUS_FORMAT = `{{.Label "${SERVICE_LABEL}"}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}`

/** Quotes an argument for display only; commands are never run through a shell. */
const quote = (arg: string): string => (/^[A-Za-z0-9_./:@=,+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)

const display = (args: readonly string[]): string => [DOCKER, ...args].map(quote).join(' ')

/**
 * A Docker Compose runtime group (adapter spec §6). It issues `docker compose`
 * only when one of its own operations is called - nothing else in docket does -
 * and builds nothing, pulls only as `pullPolicy` allows, and keeps volumes
 * unless destroying them is asked for by name.
 */
export const composeRuntime = (context: ComposeRuntimeContext): ComposeRuntime => {
  const { id, config, projectRoot, runner } = context
  const composeFile = isAbsolute(config.composeFile) ? config.composeFile : resolve(projectRoot, config.composeFile)
  const services = config.services ?? []
  const base = ['compose', '--file', composeFile, '--project-name', config.projectName]

  const args = {
    config: [...base, 'config', '--format', 'json', ...services],
    // `--pull` makes Compose itself enforce the policy; `--no-build` because
    // building would pull base images no policy covers.
    up: [...base, 'up', '--detach', '--pull', config.pullPolicy, '--no-build', ...services],
    // Read-only, and by Compose's project label rather than through the file,
    // so checking needs none of the file's variables - secrets included - set.
    status: ['ps', '--all', '--filter', `label=${PROJECT_LABEL}=${config.projectName}`, '--format', STATUS_FORMAT],
    // By project name without `--file`, so Compose finds the containers by
    // label and stopping needs none of the file's variables set either.
    down: ['compose', '--project-name', config.projectName, 'down', ...services],
    destroyVolumes: ['compose', '--project-name', config.projectName, 'down', '--volumes', ...services]
  }

  const run = async (operation: string, argv: readonly string[], stream = false): Promise<CommandOutcome> => {
    try {
      return await runner({ command: DOCKER, args: argv, cwd: projectRoot, stream })
    } catch (cause) {
      if (cause instanceof CommandNotFoundError) {
        throw new Error(
          `Runtime "${id}": docker was not found on PATH. \`docket runtime ${operation}\` needs Docker with the Compose plugin; nothing else in docket does.`,
          { cause }
        )
      }
      throw cause
    }
  }

  const failed = (operation: string, outcome: CommandOutcome, tool = 'docker compose'): Error => {
    const said = outcome.stderr.trim() || outcome.stdout.trim()
    return new Error(
      `Runtime "${id}": ${tool} ${operation} exited with ${outcome.exitCode}${said ? `:\n${said.slice(-2000)}` : ''}`
    )
  }

  const plan = async (): Promise<RuntimePlan> => {
    const problems: string[] = []
    let resolved: PlannedService[] = []

    if (!existsSync(composeFile)) {
      problems.push(`The Compose file ${composeFile} does not exist. docket never writes one: create it with the images you approve.`)
    } else {
      const outcome = await run('plan', args.config)
      if (outcome.exitCode !== 0) {
        // Compose's own message: it names unset variables, never their values.
        problems.push(`docker compose could not resolve ${composeFile}: ${(outcome.stderr.trim() || outcome.stdout.trim()).slice(-2000)}`)
      } else {
        const project = parseJson(outcome.stdout) as { services?: Record<string, ComposeService> } | undefined
        if (project?.services === undefined) {
          problems.push(`docker compose config printed no services for ${composeFile}.`)
        } else {
          resolved = Object.entries(project.services)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, service]) => plannedService(name, service))
          for (const name of services) {
            if (!(name in project.services)) problems.push(`Service "${name}" is not defined in ${composeFile}.`)
          }
          for (const service of resolved) {
            if (service.image === undefined) {
              problems.push(`Service "${service.name}" has no image. docket runs images and never builds them; set \`image:\` in ${composeFile}.`)
            }
          }
        }
      }
    }

    const target = services.length > 0 ? services.join(', ') : 'every service'
    return {
      runtime: id,
      provider: 'docker-compose',
      composeFile,
      projectName: config.projectName,
      pullPolicy: config.pullPolicy,
      services: [...services],
      adapters: [...context.adapters],
      resolved,
      operations: {
        up: { command: display(args.up), description: `start ${target}, pulling ${PULLS[config.pullPolicy]}` },
        status: { command: display(args.status), description: 'report state and health; changes nothing' },
        down: { command: display(args.down), description: `stop and remove the containers of ${target}; volumes are kept` },
        destroyVolumes: {
          command: display(args.destroyVolumes),
          description: 'also delete the volumes and the data in them - only with `docket runtime down --destroy-volumes`'
        }
      },
      problems
    }
  }

  const up = async (): Promise<RuntimeAction> => {
    const outcome = await run('up', args.up, true)
    if (outcome.exitCode !== 0) {
      if (/unknown flag:? .*--pull/i.test(outcome.stderr)) {
        throw new Error(
          `Runtime "${id}": this Docker Compose cannot enforce pullPolicy "${config.pullPolicy}" (it has no \`up --pull\`), so nothing was started. Upgrade Docker Compose.`
        )
      }
      throw failed('up', outcome)
    }
    return { runtime: id, command: display(args.up) }
  }

  const status = async (): Promise<RuntimeStatus> => {
    const outcome = await run('status', args.status)
    if (outcome.exitCode !== 0) throw failed('ps', outcome, 'docker')
    const reported = parseContainers(outcome.stdout).filter(
      (container) => services.length === 0 || services.includes(container.service)
    )
    for (const name of services) {
      if (!reported.some((entry) => entry.service === name)) reported.push({ service: name, state: 'not created' })
    }
    reported.sort((a, b) => a.service.localeCompare(b.service))
    return { runtime: id, projectName: config.projectName, services: reported }
  }

  const down = async (options: DownOptions = {}): Promise<RuntimeAction> => {
    const argv = options.destroyVolumes === true ? args.destroyVolumes : args.down
    const outcome = await run('down', argv, true)
    if (outcome.exitCode !== 0) throw failed('down', outcome)
    return { runtime: id, command: display(argv) }
  }

  return { plan, up, status, down }
}

const PULLS: Record<PullPolicy, string> = {
  never: 'nothing (images must already be present)',
  missing: 'only images not already present',
  always: 'every image'
}

/** The parts of `docker compose config --format json` the plan reads. */
interface ComposeService {
  image?: string
  environment?: Record<string, string | null> | null
  ports?: { host_ip?: string; published?: string | number; target?: number; protocol?: string }[]
  volumes?: { type?: string; source?: string; target?: string }[]
}

const plannedService = (name: string, service: ComposeService): PlannedService => ({
  name,
  ...(service.image !== undefined ? { image: service.image } : {}),
  ports: (service.ports ?? []).map((port) =>
    [port.host_ip, port.published, port.target].filter((part) => part !== undefined && part !== '').join(':') +
    (port.protocol ? `/${port.protocol}` : '')
  ),
  volumes: (service.volumes ?? []).map((volume) =>
    volume.source ? `${volume.source}:${volume.target ?? ''}` : (volume.target ?? '')
  ),
  environment: Object.keys(service.environment ?? {}).sort()
})

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Docker reports health only inside the status text, e.g. `Up 2 minutes (healthy)`. */
const HEALTH = /\((healthy|unhealthy|health: starting)\)/

/** The lines `STATUS_FORMAT` prints. */
const parseContainers = (stdout: string): ServiceStatus[] =>
  stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [service = '', container = '', state = '', status = '', image = ''] = line.split('\t')
      const health = HEALTH.exec(status)?.[1]?.replace('health: ', '')
      return {
        service,
        state: state || 'unknown',
        ...(health ? { health } : {}),
        ...(container ? { container } : {}),
        ...(image ? { image } : {}),
        ...(status ? { status } : {})
      }
    })
