import { z } from 'zod'

/**
 * Local resources docket may manage, kept apart from how an adapter connects
 * (docs/adapter-spec.md §6). A connection to an external service is the
 * default; a runtime group is opt-in, and only `docket runtime` ever acts on
 * one. Nothing else - loading, sync, search, open - reads this section.
 */

/** Runtime ids name what `docket runtime <command> <id>` acts on. */
const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** What Compose itself accepts as a project name. */
const COMPOSE_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/

export const runtimeIdSchema = z
  .string()
  .regex(RUNTIME_ID, 'a runtime id starts with a letter or digit and uses only letters, digits, ".", "_" and "-"')

/**
 * When images are pulled: `never` uses only images already present, `missing`
 * pulls those that are not, `always` pulls every time. `never` by default, so
 * nothing is downloaded unless the configuration says so.
 */
export const pullPolicySchema = z.enum(['never', 'missing', 'always'])

export type PullPolicy = z.infer<typeof pullPolicySchema>

/**
 * A user-owned Compose file run as one Compose project. Images, commands,
 * environment, volumes, health checks and networks all live in that file;
 * docket supplies none of its own. Strict, so a misspelt field fails rather
 * than being silently ignored.
 */
export const dockerComposeRuntimeSchema = z.strictObject({
  provider: z.literal('docker-compose'),
  /** Relative to the directory holding `.docket.yaml`. */
  composeFile: z.string().min(1),
  projectName: z
    .string()
    .regex(COMPOSE_PROJECT_NAME, 'a Compose project name uses only lowercase letters, digits, "_" and "-", starting with a letter or digit'),
  pullPolicy: pullPolicySchema.default('never'),
  /** The services docket starts, checks and stops. Unset: every service in the file. */
  services: z.array(z.string().min(1)).min(1).optional()
})

export type DockerComposeRuntimeConfig = z.infer<typeof dockerComposeRuntimeSchema>

/** One runtime group. Other providers (Podman, a local process) would join this union. */
export const runtimeConfigSchema = z.discriminatedUnion('provider', [dockerComposeRuntimeSchema])

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>

/** The `runtimes` section: runtime groups by id. */
export const runtimesConfigSchema = z.record(runtimeIdSchema, runtimeConfigSchema)

export type RuntimesConfig = z.infer<typeof runtimesConfigSchema>

/** An adapter instance's optional `runtime:` - the id of the group whose resources it connects to. */
export const runtimeReferenceSchema = z.object({
  runtime: runtimeIdSchema.optional()
})
