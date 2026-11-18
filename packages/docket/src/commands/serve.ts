import { resolveAdapterModule } from '../adapters/resolve-module.js'

/*
 * `docket serve`: a self-hosted, single-tenant Docket server - Docket's
 * whole MCP surface for several people and agents at once, over a project's
 * own files by default or a Postgres database - is built on
 * `@chrisjowen/docket-server`, which builds on docket. docket loads it only
 * when serving, from beside itself, so every other command runs without it.
 */

/** The package `docket serve` runs on. */
export const SERVER_PACKAGE = '@chrisjowen/docket-server'

export type ServeRole = 'owner' | 'admin' | 'editor' | 'viewer'

export interface ServeTokenRecord {
  name: string
  prefix?: string
  role: ServeRole
  scopes: string[]
  workspaces: string[]
  createdAt?: string
}

export interface ServeConfigView {
  file: string | null
  listen: { host: string; port: number }
  publicUrl: string | null
  dataDir: string
  workspaces: { slug: string; path: string | null }[]
  database: { url: string; schema: string } | null
  projections: { id: string }[]
  auth: { tokensFile: string; tokens: ServeTokenRecord[] }
  ontology: { mcpWriters: ServeRole[] }
  ai: unknown
  ui: boolean
}

/** What docket calls of `@chrisjowen/docket-server/serve`. */
export interface ServeModule {
  loadServeConfig(options: { file?: string | undefined; cwd?: string | undefined; host?: string | undefined; port?: number | undefined }): Promise<ServeConfigView>
  startServe(
    config: ServeConfigView,
    options?: { rebuild?: boolean }
  ): Promise<{ url: string; port: number; backend: { kind: 'files' | 'postgres'; workspaces: readonly { slug: string }[] }; close(): Promise<void> }>
  createToken(
    config: ServeConfigView,
    input: { name: string; role: ServeRole; scopes?: readonly string[] | undefined; workspaces?: readonly string[] | undefined }
  ): Promise<{ token: string; record: ServeTokenRecord }>
  listTokens(config: ServeConfigView): Promise<(ServeTokenRecord & { inConfig: boolean })[]>
  revokeToken(config: ServeConfigView, name: string): Promise<boolean>
}

/**
 * `@chrisjowen/docket-server/serve`: installed beside docket (globally, or in
 * the project docket runs from), else in the project at or above `cwd`; or
 * an error saying how to install it.
 */
export const loadServeModule = async (cwd: string = process.cwd()): Promise<ServeModule> => {
  const specifier = `${SERVER_PACKAGE}/serve`
  try {
    return (await import(specifier)) as ServeModule
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if ((code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') && String((cause as Error).message).includes(SERVER_PACKAGE)) {
      let local: string | undefined
      try {
        const resolved = resolveAdapterModule(specifier, { id: 'serve', projectRoot: cwd })
        local = resolved.kind === 'package' ? resolved.url : undefined
      } catch {
        local = undefined
      }
      if (local) return (await import(local)) as ServeModule
      throw new Error(
        `docket serve runs on ${SERVER_PACKAGE}, which is not installed beside docket. ` +
          `Install it where docket is: npm install -g ${SERVER_PACKAGE} (or npm install ${SERVER_PACKAGE} in this project). ` +
          'For a Postgres database, install pg too.'
      )
    }
    throw cause
  }
}

export const SERVE_ROLES: readonly ServeRole[] = ['owner', 'admin', 'editor', 'viewer']
