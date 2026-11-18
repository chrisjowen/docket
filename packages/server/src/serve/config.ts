import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { findConfigFile, summarizeConfigSchema, type SummarizeConfig } from '@chrisjowen/docket/host'
import { parse } from 'yaml'

import { isRole, type Role } from '../auth/roles.js'
import { isScope, type Scope } from '../auth/scopes.js'
import { WORKSPACE_SLUG } from '../postgres/workspaces.js'

/*
 * `docket serve`'s configuration: `docket-server.yaml`, or the environment,
 * which overrides it. With nothing set it serves the project at or above the
 * working directory from its own files, indexed by its own projections
 * (jsonl, unless the project says otherwise): no database to run.
 */

/** The file `docket serve` reads when `--config` does not name one. */
export const CONFIG_FILE = 'docket-server.yaml'

/** Where it listens when nothing says: this machine only, as `docket open` does. */
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 4390

/** A token as the server keeps it: its hash, never the token itself. */
export interface TokenRecord {
  name: string
  /** SHA-256 of the token, hex. */
  sha256: string
  /** The token's first characters, to tell tokens apart in a listing. */
  prefix?: string
  role: Role
  /** The most it may do; its role, and for `ontology:write` the server's `ontology.mcpWriters`, cut it further on every call. */
  scopes: Scope[]
  /** The workspaces it opens, by slug; `*` for every one. */
  workspaces: string[]
  createdAt?: string
}

/** One workspace the server serves. */
export interface WorkspaceConfig {
  /** Its URL name: `/mcp/<slug>`. */
  slug: string
  /** Files: the project directory whose docket it is. Postgres: a project whose ontology a new workspace starts from, if any. */
  path: string | null
  /** Postgres: the ontology file a new workspace starts with; the project's, else docket's default template, when unset. */
  ontology: string | null
}

/** A projection a Postgres-backed server indexes each workspace into: a docket adapter instance. */
export interface ProjectionConfig {
  id: string
  module: string
  config: Record<string, unknown>
}

export interface ServeConfig {
  /** The config file read, if any. */
  file: string | null
  listen: { host: string; port: number }
  /** The URL clients reach the server at; `http://<host>:<port>` when unset. */
  publicUrl: string | null
  /** Where the server keeps its own state: tokens, the audit log, a Postgres server's projections. */
  dataDir: string
  workspaces: WorkspaceConfig[]
  /** Null: every workspace is a project's files. Set: the canonical store is this Postgres database. */
  database: { url: string; schema: string } | null
  /** How a Postgres store keeps document bodies at rest. */
  codec: { kind: 'plaintext' } | { kind: 'localKey'; file: string }
  /** What a Postgres-backed server indexes each workspace into. A files-backed one uses each project's own adapters. */
  projections: ProjectionConfig[]
  auth: {
    /** The tokens `docket serve token create` adds to. */
    tokensFile: string
    /** Tokens given in the config itself, read-only to the token commands. */
    tokens: TokenRecord[]
  }
  ontology: {
    /** The roles whose tokens may publish the ontology over MCP (`ontology:write`). */
    mcpWriters: Role[]
  }
  /** The model `docket_ask` writes answers with; null turns `docket_ask` off (search needs none). */
  ai: SummarizeConfig | null
  /** Serve docket open's page and its reads, behind a sign-in with a token. */
  ui: boolean
}

export class ServeConfigError extends Error {
  override name = 'ServeConfigError'
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The projection modules a short name stands for, with the config each gets in a Postgres-backed server. */
export const PROJECTION_PRESETS: Record<string, (database: string | null) => ProjectionConfig> = {
  jsonl: () => ({ id: 'jsonl', module: '@docket/adapter-jsonl', config: { output: '.index' } }),
  sqlite: () => ({ id: 'sqlite', module: '@docket/adapter-sqlite', config: {} }),
  postgres: () => ({ id: 'postgres', module: '@docket/adapter-postgres', config: { urlEnv: 'DOCKET_DATABASE_URL' } })
}

/** A slug for a directory: its name, lowercased, with anything else made a dash. */
export function slugOf(directory: string): string {
  const slug = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return WORKSPACE_SLUG.test(slug) ? slug : 'docket'
}

const list = (value: string | undefined): string[] | undefined =>
  value === undefined
    ? undefined
    : value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)

function roles(value: unknown, where: string): Role[] {
  if (!Array.isArray(value) || !value.every(isRole)) throw new ServeConfigError(`${where} is a list of roles: owner, admin, editor, viewer.`)
  return [...new Set(value)]
}

function tokenRecord(value: unknown, where: string): TokenRecord {
  if (!isObject(value)) throw new ServeConfigError(`${where} is a token: { name, sha256, role, scopes, workspaces }.`)
  const { name, sha256, prefix, role, scopes, workspaces, createdAt } = value
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(name)) throw new ServeConfigError(`${where}.name is 1-64 letters, digits, ".", "_" or "-".`)
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new ServeConfigError(`${where}.sha256 is the token's SHA-256, 64 hex digits.`)
  if (!isRole(role)) throw new ServeConfigError(`${where}.role is owner, admin, editor or viewer.`)
  if (!Array.isArray(scopes) || !scopes.every(isScope)) throw new ServeConfigError(`${where}.scopes is a list of docket's scopes.`)
  const opens = workspaces ?? ['*']
  if (!Array.isArray(opens) || !opens.every((slug) => typeof slug === 'string')) throw new ServeConfigError(`${where}.workspaces is a list of workspace slugs, or ["*"].`)
  return {
    name,
    sha256,
    ...(typeof prefix === 'string' ? { prefix } : {}),
    role,
    scopes: [...new Set(scopes)],
    workspaces: opens as string[],
    ...(typeof createdAt === 'string' ? { createdAt } : {})
  }
}

/** Reads a list of tokens (a tokens file's, or the config's `auth.tokens`). */
export function tokenRecords(value: unknown, where: string): TokenRecord[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ServeConfigError(`${where} is a list of tokens.`)
  const records = value.map((entry, index) => tokenRecord(entry, `${where}[${index}]`))
  const names = new Set<string>()
  for (const record of records) {
    if (names.has(record.name)) throw new ServeConfigError(`${where} names the token "${record.name}" twice.`)
    names.add(record.name)
  }
  return records
}

export interface LoadServeConfigOptions {
  /** The config file; `DOCKET_SERVE_CONFIG`, else `docket-server.yaml` in `cwd` if there is one. */
  file?: string | undefined
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  /** Overrides from the command line. */
  host?: string | undefined
  port?: number | undefined
}

/**
 * The server's configuration: the file, then the environment over it, then
 * the command line. Paths in the file resolve from its directory; the
 * environment's and the command line's from `cwd`.
 */
export async function loadServeConfig(options: LoadServeConfigOptions = {}): Promise<ServeConfig> {
  // A variable set to nothing is unset: Compose and Helm pass an option left out that way.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(options.env ?? process.env).filter(([, value]) => value !== ''))
  const cwd = resolve(options.cwd ?? process.cwd())
  const named = options.file ?? env.DOCKET_SERVE_CONFIG
  const file = named ? resolve(cwd, named) : existsSync(join(cwd, CONFIG_FILE)) ? join(cwd, CONFIG_FILE) : null
  let raw: Record<string, unknown> = {}
  if (file) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (cause) {
      throw new ServeConfigError(`${file} cannot be read: ${(cause as Error).message}`)
    }
    const parsed: unknown = parse(text) ?? {}
    if (!isObject(parsed)) throw new ServeConfigError(`${file} is not a mapping.`)
    raw = parsed
  }
  const base = file ? dirname(file) : cwd
  const from = (path: string, dir = base) => (isAbsolute(path) ? path : resolve(dir, path))
  const where = (key: string) => `${file ?? 'the configuration'}: ${key}`

  const listen = isObject(raw.listen) ? raw.listen : {}
  const host = options.host ?? env.DOCKET_SERVE_HOST ?? (typeof listen.host === 'string' ? listen.host : DEFAULT_HOST)
  const portValue = options.port ?? (env.DOCKET_SERVE_PORT !== undefined ? Number(env.DOCKET_SERVE_PORT) : listen.port ?? DEFAULT_PORT)
  if (typeof portValue !== 'number' || !Number.isInteger(portValue) || portValue < 0 || portValue > 65_535) throw new ServeConfigError(`${where('listen.port')} is a port number.`)

  const publicUrl = env.DOCKET_PUBLIC_URL ?? (typeof raw.publicUrl === 'string' ? raw.publicUrl : null)
  if (publicUrl !== null) {
    try {
      const url = new URL(publicUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      throw new ServeConfigError(`${where('publicUrl')} is an http(s) URL.`)
    }
  }
  const dataDir = env.DOCKET_DATA_DIR ? from(env.DOCKET_DATA_DIR, cwd) : typeof raw.dataDir === 'string' ? from(raw.dataDir) : join(base, '.docket-server')

  // The database: opt in with database.url, or DOCKET_DATABASE_URL.
  const db = isObject(raw.database) ? raw.database : null
  const urlEnv = db && typeof db.urlEnv === 'string' ? db.urlEnv : null
  const url = env.DOCKET_DATABASE_URL ?? (urlEnv ? env[urlEnv] : undefined) ?? (db && typeof db.url === 'string' ? db.url : undefined)
  if (db && urlEnv && url === undefined) throw new ServeConfigError(`${where('database.urlEnv')} names ${urlEnv}, which is not set.`)
  const schema = env.DOCKET_DATABASE_SCHEMA ?? (db && typeof db.schema === 'string' ? db.schema : 'public')
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new ServeConfigError(`${where('database.schema')} is a lowercase SQL identifier.`)
  const database = url ? { url, schema } : null

  // Workspaces: the file's, DOCKET_WORKSPACES (slug or slug=path), else the project at or above the working directory.
  const workspaces: WorkspaceConfig[] = []
  const fromEnv = list(env.DOCKET_WORKSPACES)
  if (fromEnv) {
    for (const entry of fromEnv) {
      const [slug, path] = entry.split('=', 2) as [string, string | undefined]
      workspaces.push({ slug, path: path ? from(path, cwd) : null, ontology: null })
    }
  } else if (raw.workspaces !== undefined) {
    if (!Array.isArray(raw.workspaces)) throw new ServeConfigError(`${where('workspaces')} is a list of { slug, path, ontology }.`)
    raw.workspaces.forEach((entry, index) => {
      const item = typeof entry === 'string' ? { slug: entry } : entry
      if (!isObject(item) || typeof item.slug !== 'string') throw new ServeConfigError(`${where(`workspaces[${index}]`)} is { slug, path, ontology }, or a slug.`)
      workspaces.push({
        slug: item.slug,
        path: typeof item.path === 'string' ? from(item.path) : null,
        ontology: typeof item.ontology === 'string' ? from(item.ontology) : null
      })
    })
  }
  if (workspaces.length === 0) {
    const project = findConfigFile(cwd)
    const root = project ? dirname(project) : cwd
    workspaces.push({ slug: slugOf(root), path: project ? root : null, ontology: null })
  }
  const slugs = new Set<string>()
  for (const workspace of workspaces) {
    if (!WORKSPACE_SLUG.test(workspace.slug)) throw new ServeConfigError(`${where('workspaces')}: "${workspace.slug}" is not a slug (1-40 lowercase letters, digits and dashes).`)
    if (slugs.has(workspace.slug)) throw new ServeConfigError(`${where('workspaces')} names "${workspace.slug}" twice.`)
    slugs.add(workspace.slug)
    if (!database) {
      if (workspace.path === null) workspace.path = cwd
      if (!findConfigFile(workspace.path)) {
        throw new ServeConfigError(`Workspace "${workspace.slug}" has no docket at ${workspace.path}: run \`docket init\` there, or set its path.`)
      }
    }
  }

  // The codec a Postgres store seals bodies with.
  const codecValue = env.DOCKET_CODEC_KEY_FILE ? { localKey: { file: env.DOCKET_CODEC_KEY_FILE } } : raw.codec ?? 'plaintext'
  let codec: ServeConfig['codec']
  if (codecValue === 'plaintext') codec = { kind: 'plaintext' }
  else if (isObject(codecValue) && isObject(codecValue.localKey) && typeof codecValue.localKey.file === 'string') {
    codec = { kind: 'localKey', file: env.DOCKET_CODEC_KEY_FILE ? from(env.DOCKET_CODEC_KEY_FILE, cwd) : from(codecValue.localKey.file) }
  } else throw new ServeConfigError(`${where('codec')} is plaintext, or { localKey: { file } }: a file holding 32 random bytes.`)

  // Projections, for a Postgres-backed server: jsonl unless the file or DOCKET_PROJECTIONS says otherwise.
  const projectionsValue: unknown = list(env.DOCKET_PROJECTIONS) ?? raw.projections ?? ['jsonl']
  if (!Array.isArray(projectionsValue) || projectionsValue.length === 0) throw new ServeConfigError(`${where('projections')} is a list: jsonl, sqlite, postgres, or { id, module, config }.`)
  const projections = projectionsValue.map((entry, index): ProjectionConfig => {
    if (typeof entry === 'string') {
      const preset = PROJECTION_PRESETS[entry]
      if (!preset) throw new ServeConfigError(`${where(`projections[${index}]`)}: "${entry}" is not one of ${Object.keys(PROJECTION_PRESETS).join(', ')}.`)
      return preset(database?.url ?? null)
    }
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.module !== 'string') {
      throw new ServeConfigError(`${where(`projections[${index}]`)} is a name, or { id, module, config }.`)
    }
    return { id: entry.id, module: entry.module, config: isObject(entry.config) ? entry.config : {} }
  })
  if (new Set(projections.map((projection) => projection.id)).size !== projections.length) throw new ServeConfigError(`${where('projections')} names an instance twice.`)

  const auth = isObject(raw.auth) ? raw.auth : {}
  const tokensFile = env.DOCKET_TOKENS_FILE ? from(env.DOCKET_TOKENS_FILE, cwd) : typeof auth.tokensFile === 'string' ? from(auth.tokensFile) : join(dataDir, 'tokens.yaml')
  const tokens = tokenRecords(auth.tokens, where('auth.tokens'))

  const ontology = isObject(raw.ontology) ? raw.ontology : {}
  const writersValue = list(env.DOCKET_ONTOLOGY_MCP_WRITERS) ?? ontology.mcpWriters ?? ['owner']
  const mcpWriters = roles(writersValue, where('ontology.mcpWriters'))
  if (mcpWriters.includes('viewer')) throw new ServeConfigError(`${where('ontology.mcpWriters')}: a viewer never changes the ontology.`)

  let ai: SummarizeConfig | null = null
  if (raw.ai !== undefined && raw.ai !== null && raw.ai !== false) {
    const parsed = summarizeConfigSchema.safeParse(raw.ai)
    if (!parsed.success) throw new ServeConfigError(`${where('ai')} is a model: { provider: claude, model } or { provider: ollama, model, url }.`)
    ai = parsed.data
  }

  const ui = env.DOCKET_SERVE_UI !== undefined ? env.DOCKET_SERVE_UI !== 'false' && env.DOCKET_SERVE_UI !== '0' : raw.ui !== false

  return {
    file,
    listen: { host, port: portValue },
    publicUrl: publicUrl === null ? null : publicUrl.replace(/\/+$/, ''),
    dataDir,
    workspaces,
    database,
    codec,
    projections,
    auth: { tokensFile, tokens },
    ontology: { mcpWriters },
    ai,
    ui
  }
}
