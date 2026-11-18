import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { withLockFile } from '@chrisjowen/docket/host'
import { parse, stringify } from 'yaml'

import { ROLES, type Role } from '../auth/roles.js'
import { SCOPES, type Scope } from '../auth/scopes.js'
import type { Authenticator, Authorizer, McpResource, Principal } from '../ports.js'
import { ServeConfigError, tokenRecords, type ServeConfig, type TokenRecord } from './config.js'

/*
 * `docket serve`'s credentials: static bearer tokens, each with a role, the
 * scopes it may use and the workspaces it opens. A token is shown once, when
 * it is made; the server keeps only its SHA-256, in the tokens file, which it
 * re-reads when it changes, so a revoked token stops working on its next
 * call. Tokens are sent as `Authorization: Bearer`, never in a URL.
 */

/** What every token begins with, so one pasted into a URL is recognised and refused. */
export const TOKEN_PREFIX = 'dks_'

const sha256 = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

/** A new token: the prefix and 32 random bytes. */
export const newToken = (): string => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`

const HEADER = `# docket serve's tokens: SHA-256 hashes only, never the tokens themselves.
# Managed with \`docket serve token create|list|revoke\`.
`

/** The tokens file's records; none when there is no file yet. */
export async function readTokensFile(file: string): Promise<TokenRecord[]> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  const data: unknown = parse(text) ?? {}
  return tokenRecords(typeof data === 'object' && data !== null ? (data as { tokens?: unknown }).tokens : undefined, file)
}

async function writeTokensFile(file: string, records: readonly TokenRecord[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, `${HEADER}${stringify({ tokens: records }, { lineWidth: 0 })}`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}

export interface CreateTokenInput {
  name: string
  role: Role
  /** Every scope when omitted: the role and `ontology.mcpWriters` cut it on every call. */
  scopes?: readonly Scope[] | undefined
  /** Every workspace (`*`) when omitted. */
  workspaces?: readonly string[] | undefined
  now?: Date
}

/** Adds a token to the tokens file; the token itself is returned, to be shown once. */
export async function createToken(config: Pick<ServeConfig, 'auth' | 'workspaces'>, input: CreateTokenInput): Promise<{ token: string; record: TokenRecord }> {
  if (!ROLES.includes(input.role)) throw new ServeConfigError(`A token's role is one of ${ROLES.join(', ')}.`)
  const workspaces = input.workspaces?.length ? [...new Set(input.workspaces)] : ['*']
  const known = new Set(config.workspaces.map((workspace) => workspace.slug))
  const unknown = workspaces.filter((slug) => slug !== '*' && !known.has(slug))
  if (unknown.length) throw new ServeConfigError(`This server serves no workspace ${unknown.join(', ')}: it serves ${[...known].join(', ')}.`)
  const token = newToken()
  const record: TokenRecord = {
    name: input.name,
    sha256: sha256(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    role: input.role,
    scopes: SCOPES.filter((scope) => (input.scopes ?? SCOPES).includes(scope)),
    workspaces,
    createdAt: (input.now ?? new Date()).toISOString()
  }
  // Validated as the file is read back, so a bad name is refused before it is written.
  tokenRecords([record], 'the token')
  await withLockFile(`${config.auth.tokensFile}.lock`, async () => {
    const records = await readTokensFile(config.auth.tokensFile)
    if ([...records, ...config.auth.tokens].some((existing) => existing.name === input.name)) {
      throw new ServeConfigError(`There is already a token named "${input.name}": revoke it first, or pick another name.`)
    }
    await writeTokensFile(config.auth.tokensFile, [...records, record])
  })
  return { token, record }
}

/** Every token: the tokens file's, then the config's own (`inConfig`, which the commands cannot change). */
export async function listTokens(config: Pick<ServeConfig, 'auth'>): Promise<(TokenRecord & { inConfig: boolean })[]> {
  const records = await readTokensFile(config.auth.tokensFile)
  return [...records.map((record) => ({ ...record, inConfig: false })), ...config.auth.tokens.map((record) => ({ ...record, inConfig: true }))]
}

/** Removes a token from the tokens file; false when it has none by that name. */
export async function revokeToken(config: Pick<ServeConfig, 'auth'>, name: string): Promise<boolean> {
  if (config.auth.tokens.some((record) => record.name === name)) {
    throw new ServeConfigError(`The token "${name}" is in the server's config file: remove it there.`)
  }
  return withLockFile(`${config.auth.tokensFile}.lock`, async () => {
    const records = await readTokensFile(config.auth.tokensFile)
    const kept = records.filter((record) => record.name !== name)
    if (kept.length === records.length) return false
    await writeTokensFile(config.auth.tokensFile, kept)
    return true
  })
}

/** A principal of `docket serve`: a token, and the workspace slug its request is for. */
export interface TokenPrincipal extends Principal {
  /** The token's name. */
  token: string
  /** The workspace's slug, as its URL names it. */
  slug: string
}

/** A workspace a request is for: its MCP URL, its id and its slug. */
export interface ServeResource extends McpResource {
  slug: string
}

/**
 * The tokens, read live: the config's and the tokens file's, the file re-read
 * whenever it changes. Resolves a bearer by its hash, compared in constant
 * time, to a principal for one workspace; its role is read on every call.
 */
export function tokenAuth(config: Pick<ServeConfig, 'auth' | 'ontology'>): {
  authenticator: Authenticator<TokenPrincipal, ServeResource>
  authorizer: Authorizer<TokenPrincipal>
  /** The token a bearer is, and the slugs it opens; null when it is none. */
  lookup(bearer: string): Promise<TokenRecord | null>
  /** The token record named `name`, read live; null once it is revoked or renamed. */
  byName(name: string): Promise<TokenRecord | null>
} {
  let cached: { mtimeMs: number; records: TokenRecord[] } | null = null
  const records = async (): Promise<TokenRecord[]> => {
    let mtimeMs = -1
    try {
      mtimeMs = (await stat(config.auth.tokensFile)).mtimeMs
    } catch {
      mtimeMs = -1
    }
    if (!cached || cached.mtimeMs !== mtimeMs) cached = { mtimeMs, records: mtimeMs < 0 ? [] : await readTokensFile(config.auth.tokensFile) }
    return [...config.auth.tokens, ...cached.records]
  }
  const lookup = async (bearer: string): Promise<TokenRecord | null> => {
    const hash = Buffer.from(sha256(bearer), 'hex')
    let found: TokenRecord | null = null
    // Every record is compared, so how long a lookup takes says nothing about which one matched.
    for (const record of await records()) {
      if (timingSafeEqual(hash, Buffer.from(record.sha256, 'hex')) && found === null) found = record
    }
    return found
  }
  const current = async (name: string): Promise<TokenRecord | null> => (await records()).find((record) => record.name === name) ?? null
  return {
    lookup,
    byName: current,
    authenticator: {
      async resolve(bearer, resource) {
        const record = await lookup(bearer)
        if (!record || !(record.workspaces.includes('*') || record.workspaces.includes(resource.slug))) return null
        return { subject: `token:${record.name}`, workspaceId: resource.workspaceId, scopes: record.scopes, actor: `token:${record.name}`, token: record.name, slug: resource.slug }
      }
    },
    authorizer: {
      // A revoked token has no role from its next call; a changed role applies from then too.
      role: async (principal) => (await current(principal.token))?.role ?? null,
      ontologyWriters: async () => config.ontology.mcpWriters
    }
  }
}
