import {
  CloudApiError,
  cloudFetch,
  credentialFrom,
  type AuthorizationServer,
  type CloudCredential,
  type CloudWorkspace,
  type TokenResponse
} from '@docket/adapter-kit'

/*
 * What `docket cloud` asks of the cloud: signing in, and the workspace's REST
 * API and MCP tools. The REST routes are the bearer API docket-cloud offers
 * for the CLI; a cloud without one answers 404, reported as "not offered yet".
 */

/** The public client the cloud registers for this CLI's device authorization. */
export const CLI_CLIENT_ID = 'docket-cli'

/** Everything a CLI session may do; the cloud caps them at the user's role. */
export const LOGIN_SCOPES = ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose'] as const

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** How a login talks to the person signing in. */
export interface LoginIO {
  /** Says where to sign in, and the code to enter when there is one. */
  show(prompt: { url: string; userCode?: string }): void
  openBrowser(url: string): void
  sleep(ms: number): Promise<void>
  /** Milliseconds since the epoch. */
  now?: () => number
}

const form = async (url: string, fields: Record<string, string>): Promise<Response> =>
  cloudFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields)
  })

const oauthError = async (response: Response): Promise<{ error: string; description?: string }> => {
  try {
    const body = (await response.json()) as { error?: unknown; error_description?: unknown }
    return {
      error: typeof body.error === 'string' ? body.error : `http_${response.status}`,
      ...(typeof body.error_description === 'string' ? { description: body.error_description } : {})
    }
  } catch {
    return { error: `http_${response.status}` }
  }
}

interface DeviceAuthorization {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

/**
 * OAuth 2.0 device authorization (RFC 8628): shows a code and opens the
 * browser, then polls the token endpoint at the interval the cloud advertised
 * - five seconds more after each `slow_down` - until the user approves,
 * declines or the code expires.
 */
export const deviceLogin = async (server: AuthorizationServer, resource: string, io: LoginIO): Promise<CloudCredential> => {
  const endpoint = server.device_authorization_endpoint
  if (endpoint === undefined) throw new Error(`${server.issuer} does not offer device sign-in yet.`)
  const now = io.now ?? Date.now
  const started = await form(endpoint, { client_id: CLI_CLIENT_ID, scope: LOGIN_SCOPES.join(' '), resource })
  if (!started.ok) {
    const { error, description } = await oauthError(started)
    throw new Error(`${server.issuer} refused to start a sign-in: ${description ?? error}`)
  }
  const authorization = (await started.json()) as DeviceAuthorization
  io.show({ url: authorization.verification_uri, userCode: authorization.user_code })
  io.openBrowser(authorization.verification_uri_complete ?? authorization.verification_uri)

  let interval = (authorization.interval ?? 5) * 1000
  const deadline = now() + authorization.expires_in * 1000
  while (now() < deadline) {
    await io.sleep(interval)
    const polled = await form(server.token_endpoint, {
      grant_type: DEVICE_GRANT,
      device_code: authorization.device_code,
      client_id: CLI_CLIENT_ID,
      resource
    })
    if (polled.ok) {
      return credentialFrom((await polled.json()) as TokenResponse, { clientId: CLI_CLIENT_ID, tokenEndpoint: server.token_endpoint, now: new Date(now()) })
    }
    const { error, description } = await oauthError(polled)
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      interval += 5000
      continue
    }
    if (error === 'access_denied') throw new Error('The sign-in was declined.')
    if (error === 'expired_token') break
    throw new Error(`The sign-in failed: ${description ?? error}`)
  }
  throw new Error('The sign-in code expired before it was approved; run `docket cloud login` again.')
}

/** Revokes a token at the cloud (RFC 7009). Best effort: a failure leaves only the token to expire. */
export const revokeToken = async (server: AuthorizationServer, token: string, clientId: string): Promise<boolean> => {
  if (server.revocation_endpoint === undefined) return false
  try {
    return (await form(server.revocation_endpoint, { token, client_id: clientId })).ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// The workspace's REST API and MCP tools

/** The cloud has no such route. */
export class NotOfferedError extends Error {
  override name = 'NotOfferedError'
}

/**
 * A REST call. A 404 without an OAuth-style `error` code is a route the cloud
 * does not have - SvelteKit's own not-found - and says so plainly; the API's
 * own 404s (an unknown workspace or token) carry `error` and are passed on.
 */
const rest = async <T>(workspace: CloudWorkspace, what: string, method: string, path: string, body?: unknown): Promise<T> => {
  try {
    return await workspace.api<T>(method, path, body)
  } catch (cause) {
    if (cause instanceof CloudApiError && cause.status === 404 && cause.code === undefined) {
      throw new NotOfferedError(`${workspace.origin} does not offer ${what} yet.`)
    }
    throw cause
  }
}

/** Who the session acts as: `GET /api/o/{org}/w/{ws}/me`. */
export interface Identity {
  login: string
  org: string
  workspace: string
  role: string
  scopes: string[]
  token: { kind: 'oauth' | 'api'; id?: string; expiresAt: string }
}

export const whoAmI = (workspace: CloudWorkspace): Promise<Identity> => rest(workspace, 'whoami', 'GET', 'me')

export interface ApiToken {
  id: string
  prefix: string
  owner?: string
  mine?: boolean
  scopes: string[]
  description?: string
  createdAt?: string
  expiresAt: string
  lastUsedAt?: string | null
  status: string
}

export interface CreatedToken {
  id: string
  /** The plaintext token: shown once, never kept. */
  token: string
  prefix: string
  scopes: string[]
  expiresAt: string
}

export const listTokens = async (workspace: CloudWorkspace): Promise<ApiToken[]> =>
  (await rest<{ tokens: ApiToken[] }>(workspace, 'API tokens over its API', 'GET', 'tokens')).tokens

export const createToken = (workspace: CloudWorkspace, input: { scopes: string[]; days: number; description?: string }): Promise<CreatedToken> =>
  rest(workspace, 'API tokens over its API', 'POST', 'tokens', input)

export const deleteToken = (workspace: CloudWorkspace, id: string): Promise<void> =>
  rest(workspace, 'API tokens over its API', 'DELETE', `tokens/${encodeURIComponent(id)}`)

/** A document as the cloud lists it. */
export interface CloudDocument {
  path: string
  hash: string
  origin: 'repo' | 'cloud' | 'cli'
  originRef?: string | null
  revision?: string
  updatedAt?: string
  raw?: string
}

/** Every page of a document listing. */
export const listDocuments = async (
  workspace: CloudWorkspace,
  query: { origin: CloudDocument['origin']; originRef?: string; raw?: boolean }
): Promise<CloudDocument[]> => {
  const documents: CloudDocument[] = []
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({ origin: query.origin })
    if (query.originRef !== undefined) params.set('originRef', query.originRef)
    if (query.raw) params.set('include', 'raw')
    if (cursor !== undefined) params.set('cursor', cursor)
    const page = await rest<{ documents: CloudDocument[]; next?: string }>(workspace, 'a documents API', 'GET', `documents?${params}`)
    documents.push(...page.documents)
    cursor = page.next
  } while (cursor !== undefined)
  return documents
}

export interface PushDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface PushRequest {
  checkout: string
  dryRun?: boolean
  upsert: { path: string; raw: string }[]
  remove: string[]
}

export interface PushResponse {
  ok: boolean
  dryRun: boolean
  created: string[]
  updated: string[]
  unchanged: string[]
  removed: string[]
  diagnostics: PushDiagnostic[]
}

export const pushDocuments = (workspace: CloudWorkspace, request: PushRequest): Promise<PushResponse> =>
  rest(workspace, 'a documents API', 'POST', 'documents/push', request)

/** The workspace's published ontology, from its `docket_ontology` tool (`docket-ontology.v1`). */
export interface CloudOntology {
  version: number
  revision: string
  yaml: string
  publishedAt?: string
}

export const cloudOntology = async (workspace: CloudWorkspace): Promise<CloudOntology> =>
  (await workspace.callTool<CloudOntology>('docket_ontology', {})).structured

/** A draft the cloud made of a proposed ontology (`docket-ontology-proposal.v1`). */
export interface OntologyProposal {
  draftId: string
  head: number
  classification: string
  changes?: unknown[]
}

export const proposeOntology = async (workspace: CloudWorkspace, yaml: string, message: string): Promise<OntologyProposal> =>
  (await workspace.callTool<OntologyProposal>('docket_propose_ontology_change', { yaml, message })).structured
