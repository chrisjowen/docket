import { z } from 'zod'

/**
 * MemPalace's own rule for wing and room names (3.10.0, `config.py`): up to
 * 128 characters, starting and ending with a letter or digit, no path syntax.
 */
export const PALACE_NAME = /^(?:[\p{L}\p{N}]|[\p{L}\p{N}][\p{L}\p{N}_ .'-]{0,126}[\p{L}\p{N}])$/u

export const isPalaceName = (name: string): boolean => PALACE_NAME.test(name) && !name.includes('..')

/**
 * A MemPalace instance: its MCP server, run as a child process the user
 * installed (`pip install mempalace==3.10.0`), over one palace directory.
 * Unknown fields are refused rather than dropped.
 */
export const mempalaceConfigSchema = z.strictObject({
  /**
   * The MemPalace MCP server: `mempalace-mcp` on PATH by default, or e.g.
   * `command: python3` with `args: ["-m", "mempalace.mcp_server"]`. Relative
   * paths resolve against the project. docket never installs it.
   */
  command: z.string().min(1).default('mempalace-mcp'),
  args: z.array(z.string()).default([]),
  /**
   * The palace directory, relative to the directory holding `.docket.yaml`.
   * Defaults to `palace` in the instance's own state directory, which keeps it
   * disposable. Point it at a shared palace to file docket's memories beside
   * others: the wing keeps them apart.
   */
  palace: z.string().min(1).optional(),
  /**
   * The wing this instance's scope is filed under. Defaults to one unique to
   * the checkout, so two projects sharing a palace never share a wing.
   */
  wing: z.string().refine(isPalaceName, 'wing must be a MemPalace name: letters, digits, " ", ".", "_", "\'" and "-", starting and ending with a letter or digit').optional(),
  /**
   * MemPalace's configuration directory (its `config.json` and write log).
   * Defaults to `mempalace` in the state directory, so docket neither reads
   * nor changes the user's own MemPalace configuration.
   */
  configDir: z.string().min(1).optional(),
  /**
   * The embedding model the palace uses. It must already be downloaded:
   * MemPalace fetches a missing model on first use, and docket never lets it.
   */
  embeddingModel: z.enum(['minilm', 'embeddinggemma']).default('minilm'),
  /** MemPalace's `max_distance` cut-off for search (cosine distance; its default is 1.5, which keeps nearly everything). */
  maxDistance: z.number().min(0).max(2).optional(),
  /** Bounds starting the server, which loads its vector store. */
  startupTimeoutMs: z.number().int().positive().default(60_000),
  /** Bounds each call; an ask is bounded by its deadline as well. */
  timeoutMs: z.number().int().positive().default(60_000)
})

export type MempalaceConfig = z.infer<typeof mempalaceConfigSchema>
