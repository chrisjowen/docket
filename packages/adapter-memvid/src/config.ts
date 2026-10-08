import { z } from 'zod'

/** Segment-safe: a namespace is one segment of every native URI, so it stays free of `/`. */
const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * A memvid instance: one `.mv2` file, written and read through the memvid CLI.
 * Embedded: no service, no runtime group, no network. Unknown fields are
 * refused rather than dropped, so a misspelt option fails loudly.
 */
export const memvidConfigSchema = z.strictObject({
  /**
   * The memory file, relative to the directory holding `.docket.yaml`.
   * Defaults to `memory.mv2` in the instance's own state directory, which keeps
   * it disposable: `docket rebuild` replays it from the canonical files.
   */
  file: z.string().min(1).optional(),
  /**
   * Every frame this instance writes has a URI under `mv2://docket/<namespace>/`,
   * and every search, listing and reset is confined to that prefix. Defaults to
   * the Docket scope. Give each project its own namespace when several share
   * one file.
   */
  namespace: z.string().regex(NAMESPACE_PATTERN, 'namespace must be one URI segment: letters, digits, ".", "_" and "-"').optional(),
  /**
   * The memvid CLI: a command on PATH or a path, relative paths resolving
   * against the project. docket never installs it.
   */
  command: z.string().min(1).default('memvid'),
  /** Upper bound on one CLI call; an ask is bounded by its deadline as well. */
  timeoutMs: z.number().int().positive().default(30_000),
  /** How long a write waits for another process holding the file's writer lock. */
  lockTimeoutMs: z.number().int().positive().default(5_000)
})

export type MemvidConfig = z.infer<typeof memvidConfigSchema>
