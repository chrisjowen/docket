import type { CredentialStore } from '@docket/adapter-kit'

import { createToken, deleteToken, listTokens, LOGIN_SCOPES, type ApiToken, type CreatedToken } from '../../cloud/client.js'
import { linkedWorkspace } from '../../cloud/credentials.js'
import { requireCloudLink } from '../../cloud/project.js'

export interface CloudTokenOptions {
  cwd?: string | undefined
  store?: CredentialStore | undefined
}

/** `30d` → 30. A token lives 1 to 90 days, as the cloud allows. */
export const parseExpiry = (value: string): number => {
  const match = /^(\d+)d$/.exec(value.trim())
  const days = match ? Number(match[1]) : Number.NaN
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error(`--expires must be a number of days from 1d to 90d, got "${value}"`)
  }
  return days
}

/** `docket:read,docket:write` or repeated flags → the scopes, each one the cloud knows. */
export const parseScopes = (values: readonly string[]): string[] => {
  const scopes = [...new Set(values.flatMap((value) => value.split(/[\s,]+/)).filter(Boolean))]
  if (scopes.length === 0) throw new Error(`--scopes must name at least one of ${LOGIN_SCOPES.join(', ')}`)
  for (const scope of scopes) {
    if (!(LOGIN_SCOPES as readonly string[]).includes(scope)) {
      throw new Error(`"${scope}" is not a scope; use ${LOGIN_SCOPES.join(', ')}`)
    }
  }
  return scopes
}

/** Signed in as yourself: a token never mints tokens, so a `tokenEnv` token is not used here. */
const workspaceOf = async (options: CloudTokenOptions) => {
  const { link } = await requireCloudLink(options.cwd ?? process.cwd())
  return linkedWorkspace(link, { store: options.store, env: {} })
}

/** A headless API token for the linked workspace, for CI. Its value is in the result once, and nowhere else. */
export const cloudTokenCreate = async (
  input: { scopes: string[]; days: number; description?: string | undefined },
  options: CloudTokenOptions = {}
): Promise<{ workspace: string; token: CreatedToken }> => {
  const workspace = await workspaceOf(options)
  const token = await createToken(workspace, {
    scopes: input.scopes,
    days: input.days,
    ...(input.description ? { description: input.description } : {})
  })
  return { workspace: workspace.label, token }
}

export const cloudTokenList = async (options: CloudTokenOptions = {}): Promise<{ workspace: string; tokens: ApiToken[] }> => {
  const workspace = await workspaceOf(options)
  return { workspace: workspace.label, tokens: await listTokens(workspace) }
}

export const cloudTokenRevoke = async (id: string, options: CloudTokenOptions = {}): Promise<{ workspace: string; id: string }> => {
  const workspace = await workspaceOf(options)
  await deleteToken(workspace, id)
  return { workspace: workspace.label, id }
}
