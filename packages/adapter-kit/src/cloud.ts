import { execFile } from 'node:child_process'
import { chmod, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { writeFileAtomic } from './atomic-write.js'

/*
 * What the `docket cloud` commands and the cloud adapter share: where a
 * signed-in session is kept, and the one door every request to Docket Cloud
 * goes through, which `DOCKET_OFFLINE` shuts.
 */

/** The Docket Cloud beta, unless a command or the config names another. */
export const DEFAULT_CLOUD_URL = 'https://docket.chrisjowen.net'

/** Set to anything but `0` or empty, every request to Docket Cloud fails before it leaves the machine. */
export const OFFLINE_ENV = 'DOCKET_OFFLINE'

/** Docket Cloud could not be reached - or was not tried, because the network is turned off. */
export class CloudUnreachableError extends Error {
  override name = 'CloudUnreachableError'
}

export const offline = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const value = env[OFFLINE_ENV]
  return value !== undefined && value !== '' && value !== '0'
}

/** `fetch`, refused while offline, with a network failure named as one. */
export const cloudFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  if (offline()) throw new CloudUnreachableError(`network access is turned off (${OFFLINE_ENV} is set)`)
  try {
    return await fetch(url, init)
  } catch (cause) {
    if (init?.signal?.aborted) throw cause
    const reason = cause instanceof Error ? ((cause.cause as Error | undefined)?.message ?? cause.message) : String(cause)
    throw new CloudUnreachableError(`could not reach ${new URL(url).origin}: ${reason}`, { cause })
  }
}

/** The cloud a URL names: its origin, which must be https unless it is on this machine. */
export const cloudOrigin = (url: string): string => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`"${url}" is not a URL: give one such as ${DEFAULT_CLOUD_URL}`)
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error(`${parsed.origin} must use https (plain http is allowed only on this machine)`)
  }
  return parsed.origin
}

const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname)

/**
 * A cloud workspace's MCP URL - what its OAuth tokens are bound to, and what a
 * signed-in session is kept under, since one sign-in is for one workspace.
 */
export const workspaceResource = (url: string, org: string, workspace: string): string =>
  `${cloudOrigin(url)}/mcp/${encodeURIComponent(org)}/${encodeURIComponent(workspace)}`

/** A resource URL as credentials are keyed: origin and path, so a trailing slash never splits a sign-in. */
const credentialKey = (resource: string): string => `${cloudOrigin(resource)}${new URL(resource).pathname.replace(/\/+$/, '')}`

/** A signed-in session with one cloud workspace. Secret: never printed, logged or written into a project. */
export interface CloudCredential {
  accessToken: string
  refreshToken?: string
  /** ISO-8601 instant the access token stops working, when the cloud said. */
  expiresAt?: string
  /** The client the tokens were issued to - the one that may refresh them. */
  clientId?: string
  /** Where a refresh is sent. */
  tokenEndpoint?: string
  scope?: string
}

/** Where a credential was kept. */
export type CredentialLocation = 'keychain' | 'file'

/**
 * The operating system's secret store, holding one string per workspace.
 * Optional everywhere: without one, credentials go to a file only the user can read.
 */
export interface Keychain {
  readonly name: string
  get(account: string): Promise<string | undefined>
  set(account: string, secret: string): Promise<void>
  remove(account: string): Promise<boolean>
}

const KEYCHAIN_SERVICE = 'docket-cloud'

const run = (command: string, args: string[], input?: string): Promise<{ code: number; stdout: string }> =>
  new Promise((resolve) => {
    const child = execFile(command, args, { encoding: 'utf8', timeout: 10_000 }, (error, stdout) => {
      // A command that is not installed reads as the shell's 127.
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : error.code === 'ENOENT' ? 127 : 1
      resolve({ code, stdout })
    })
    child.stdin?.end(input ?? '')
  })

/**
 * macOS's login keychain through `security`. The secret goes in on standard
 * input, through its interactive mode, never on the command line where any
 * process could read it. Stored hex-encoded, so no quoting can break it.
 */
const macosKeychain: Keychain = {
  name: 'macOS keychain',
  async get(account) {
    const result = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'])
    if (result.code !== 0) return undefined
    return Buffer.from(result.stdout.trim(), 'hex').toString('utf8')
  },
  async set(account, secret) {
    const hex = Buffer.from(secret, 'utf8').toString('hex')
    const command = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${hex}"\n`
    const result = await run('security', ['-i'], command)
    if (result.code !== 0) throw new Error('the macOS keychain refused the credential')
    if ((await this.get(account)) !== secret) throw new Error('the macOS keychain did not keep the credential')
  },
  async remove(account) {
    return (await run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account])).code === 0
  }
}

/** The Secret Service (GNOME Keyring, KWallet) through `secret-tool`, which reads the secret from standard input. */
const secretServiceKeychain: Keychain = {
  name: 'Secret Service',
  async get(account) {
    const result = await run('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', account])
    return result.code === 0 && result.stdout !== '' ? result.stdout : undefined
  },
  async set(account, secret) {
    const label = `Docket Cloud (${account})`
    const result = await run('secret-tool', ['store', '--label', label, 'service', KEYCHAIN_SERVICE, 'account', account], secret)
    if (result.code !== 0) throw new Error('the Secret Service refused the credential')
  },
  async remove(account) {
    return (await run('secret-tool', ['clear', 'service', KEYCHAIN_SERVICE, 'account', account])).code === 0
  }
}

/** Set to `off`, credentials skip the keychain and go to the file. */
export const KEYCHAIN_ENV = 'DOCKET_KEYCHAIN'

/** This machine's keychain, when it has one docket can use and it is not turned off. */
export const systemKeychain = async (env: NodeJS.ProcessEnv = process.env): Promise<Keychain | undefined> => {
  if (env[KEYCHAIN_ENV] === 'off') return undefined
  if (process.platform === 'darwin') return (await run('security', ['help'])).code !== 127 ? macosKeychain : undefined
  if (process.platform === 'linux') {
    return (await run('secret-tool', ['--version'])).code !== 127 ? secretServiceKeychain : undefined
  }
  return undefined
}

/** `~/.config/docket/credentials.json`, or under `$XDG_CONFIG_HOME` when set. */
export const defaultCredentialsFile = (env: NodeJS.ProcessEnv = process.env): string =>
  join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'docket', 'credentials.json')

interface CredentialsFile {
  version: 1
  /** By workspace resource URL. */
  clouds: Record<string, CloudCredential>
}

const readCredentialsFile = async (file: string): Promise<CredentialsFile> => {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, clouds: {} }
    throw cause
  }
  const parsed = JSON.parse(text) as Partial<CredentialsFile>
  return { version: 1, clouds: typeof parsed.clouds === 'object' && parsed.clouds !== null ? parsed.clouds : {} }
}

const isCredential = (value: unknown): value is CloudCredential =>
  typeof value === 'object' && value !== null && typeof (value as CloudCredential).accessToken === 'string'

export interface CredentialStoreOptions {
  /** The fallback file. Default: `defaultCredentialsFile()`. */
  file?: string
  /** The keychain to try first; `null` for none. Default: `systemKeychain()`. */
  keychain?: Keychain | null
}

/**
 * Signed-in sessions, one per workspace resource URL: in the keychain when this machine
 * has one, otherwise in a JSON file created with mode 0600. Reading looks in
 * both, so a session kept before a keychain was available is still found.
 */
export class CredentialStore {
  readonly file: string
  private readonly keychain: Promise<Keychain | undefined>

  constructor(options: CredentialStoreOptions = {}) {
    this.file = options.file ?? defaultCredentialsFile()
    this.keychain = options.keychain === undefined ? systemKeychain() : Promise.resolve(options.keychain ?? undefined)
  }

  async read(resource: string): Promise<CloudCredential | undefined> {
    const key = credentialKey(resource)
    const keychain = await this.keychain
    if (keychain) {
      const secret = await keychain.get(key)
      if (secret !== undefined) {
        try {
          const parsed: unknown = JSON.parse(secret)
          if (isCredential(parsed)) return parsed
        } catch {
          // Not ours, or damaged: fall through to the file.
        }
      }
    }
    const stored = (await readCredentialsFile(this.file)).clouds[key]
    return isCredential(stored) ? stored : undefined
  }

  /** Keeps the credential, and says where. A keychain that refuses it leaves the file to keep it. */
  async write(resource: string, credential: CloudCredential): Promise<CredentialLocation> {
    const key = credentialKey(resource)
    const keychain = await this.keychain
    if (keychain) {
      try {
        await keychain.set(key, JSON.stringify(credential))
        await this.removeFromFile(key)
        return 'keychain'
      } catch {
        // Locked, or refused: the file is the fallback.
      }
    }
    const contents = await readCredentialsFile(this.file)
    contents.clouds[key] = credential
    await writeFileAtomic(this.file, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
    // The file may have existed with a looser mode; this one holds tokens.
    await chmod(this.file, 0o600)
    return 'file'
  }

  /** Forgets the workspace's session wherever it is kept. True when there was one. */
  async remove(resource: string): Promise<boolean> {
    const key = credentialKey(resource)
    const keychain = await this.keychain
    const fromKeychain = keychain ? await keychain.remove(key) : false
    const fromFile = await this.removeFromFile(key)
    return fromKeychain || fromFile
  }

  private async removeFromFile(key: string): Promise<boolean> {
    const contents = await readCredentialsFile(this.file)
    if (!(key in contents.clouds)) return false
    delete contents.clouds[key]
    if (Object.keys(contents.clouds).length === 0) await rm(this.file, { force: true })
    else await writeFileAtomic(this.file, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
    return true
  }
}

// ---------------------------------------------------------------------------
// Talking to one workspace

/** There is no usable sign-in for the workspace: signing in again is the fix. */
export class CloudAuthError extends Error {
  override name = 'CloudAuthError'
}

/** The cloud answered, with an error. */
export class CloudApiError extends Error {
  override name = 'CloudApiError'
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
  }
}

/** The MCP protocol version docket speaks to the cloud. */
export const MCP_PROTOCOL_VERSION = '2025-11-25'

/** What docket reads of a cloud's OAuth authorization server metadata (RFC 8414). */
export interface AuthorizationServer {
  issuer: string
  token_endpoint: string
  authorization_endpoint?: string
  device_authorization_endpoint?: string
  registration_endpoint?: string
  revocation_endpoint?: string
}

export const authorizationServer = async (url: string, signal?: AbortSignal): Promise<AuthorizationServer> => {
  const origin = cloudOrigin(url)
  const response = await cloudFetch(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {})
  })
  if (!response.ok) throw new CloudApiError(`${origin} is not a Docket Cloud: it publishes no OAuth metadata (HTTP ${response.status})`, response.status)
  const metadata = (await response.json()) as Partial<AuthorizationServer>
  if (typeof metadata.token_endpoint !== 'string') throw new CloudApiError(`${origin} publishes OAuth metadata without a token endpoint`, 502)
  return metadata as AuthorizationServer
}

/** A token endpoint's success response (RFC 6749 §5.1). */
export interface TokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

/** A token response as the credential kept for it. */
export const credentialFrom = (
  token: TokenResponse,
  issued: { clientId: string; tokenEndpoint: string; now?: Date }
): CloudCredential => ({
  accessToken: token.access_token,
  ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
  ...(typeof token.expires_in === 'number'
    ? { expiresAt: new Date((issued.now ?? new Date()).getTime() + token.expires_in * 1000).toISOString() }
    : {}),
  clientId: issued.clientId,
  tokenEndpoint: issued.tokenEndpoint,
  ...(token.scope ? { scope: token.scope } : {})
})

/** The error a JSON error body states, as OAuth and the cloud's API write them. */
const errorOf = async (response: Response): Promise<{ code?: string; message: string }> => {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown; message?: unknown }
    const code = typeof body.error === 'string' ? body.error : undefined
    const described = typeof body.error_description === 'string' ? body.error_description : typeof body.message === 'string' ? body.message : undefined
    return { ...(code ? { code } : {}), message: described ?? code ?? `HTTP ${response.status}` }
  } catch {
    return { message: `HTTP ${response.status}` }
  }
}

/** A refresh this close to expiry is done before the request, not after a 401. */
const REFRESH_MARGIN_MS = 30_000

export interface CloudWorkspaceOptions {
  url: string
  org: string
  workspace: string
  /** A fixed token - an API token from the environment. Used as is: never refreshed or stored. */
  token?: string | undefined
  /** Where the signed-in session is kept. Default: a `CredentialStore` with its defaults. */
  store?: CredentialStore | undefined
  now?: () => Date
}

export interface ToolResult<T> {
  structured: T
  text: string
}

/**
 * One cloud workspace, as a signed-in client sees it: its MCP endpoint and
 * its REST API, each request carrying the session's bearer token. An access
 * token near its expiry is refreshed first, and the rotated tokens kept; a
 * request refused with 401 is refreshed and tried once more.
 */
export class CloudWorkspace {
  readonly origin: string
  readonly org: string
  readonly workspace: string
  /** The workspace's MCP URL, which its tokens are bound to. */
  readonly resource: string
  readonly store: CredentialStore
  private readonly token: string | undefined
  private readonly now: () => Date
  private requests = 0

  constructor(options: CloudWorkspaceOptions) {
    this.origin = cloudOrigin(options.url)
    this.org = options.org
    this.workspace = options.workspace
    this.resource = workspaceResource(this.origin, options.org, options.workspace)
    this.store = options.store ?? new CredentialStore()
    this.token = options.token
    this.now = options.now ?? (() => new Date())
  }

  /** `acme/platform on https://...`, for messages. */
  get label(): string {
    return `${this.org}/${this.workspace} on ${this.origin}`
  }

  private signInAgain(why: string): CloudAuthError {
    return new CloudAuthError(
      this.token !== undefined
        ? `${why}: the token given for ${this.label} was refused`
        : `${why}: run \`docket cloud login\` to sign in to ${this.label}`
    )
  }

  private async refreshed(credential: CloudCredential, signal?: AbortSignal): Promise<CloudCredential> {
    if (!credential.refreshToken || !credential.clientId || !credential.tokenEndpoint) throw this.signInAgain('The session has expired')
    const response = await cloudFetch(credential.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: credential.clientId,
        resource: this.resource
      }),
      ...(signal ? { signal } : {})
    })
    if (!response.ok) {
      const { code } = await errorOf(response)
      if (response.status === 400 || response.status === 401) throw this.signInAgain(`The session could not be renewed (${code ?? response.status})`)
      throw new CloudApiError(`${this.origin} could not renew the session (HTTP ${response.status})`, response.status, code)
    }
    const renewed = credentialFrom((await response.json()) as TokenResponse, {
      clientId: credential.clientId,
      tokenEndpoint: credential.tokenEndpoint,
      now: this.now()
    })
    // A rotated refresh token replaces the old one; one not rotated stays.
    const kept = { ...renewed, refreshToken: renewed.refreshToken ?? credential.refreshToken }
    await this.store.write(this.resource, kept)
    return kept
  }

  /** The bearer token for the next request, renewed first when it is about to expire. */
  private async accessToken(signal?: AbortSignal, renew = false): Promise<string> {
    if (this.token !== undefined) return this.token
    if (offline()) throw new CloudUnreachableError(`network access is turned off (${OFFLINE_ENV} is set)`)
    const credential = await this.store.read(this.resource)
    if (credential === undefined) throw this.signInAgain('Not signed in')
    const expiring =
      credential.expiresAt !== undefined && Date.parse(credential.expiresAt) - this.now().getTime() < REFRESH_MARGIN_MS
    return renew || expiring ? (await this.refreshed(credential, signal)).accessToken : credential.accessToken
  }

  /** A request to the cloud with the bearer token, renewed and tried again once on a 401. */
  async request(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal | undefined } = {}): Promise<Response> {
    const send = async (token: string): Promise<Response> =>
      cloudFetch(new URL(path, this.origin), {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(path.startsWith('/mcp/') ? { 'mcp-protocol-version': MCP_PROTOCOL_VERSION } : {})
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(init.signal ? { signal: init.signal } : {})
      })
    const response = await send(await this.accessToken(init.signal))
    if (response.status !== 401 || this.token !== undefined) return response
    return send(await this.accessToken(init.signal, true))
  }

  /** A call to the workspace's REST API, `/api/o/{org}/w/{ws}/<path>`, answered with JSON. */
  async api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const route = `/api/o/${encodeURIComponent(this.org)}/w/${encodeURIComponent(this.workspace)}/${path}`
    const response = await this.request(route, { method, body, signal })
    if (response.status === 401) throw this.signInAgain((await errorOf(response)).message)
    if (!response.ok) {
      const { code, message } = await errorOf(response)
      throw new CloudApiError(message, response.status, code)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  /** One JSON-RPC request to the workspace's MCP endpoint, its result. */
  private async rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.requests += 1
    const path = new URL(this.resource).pathname
    const response = await this.request(path, { method: 'POST', body: { jsonrpc: '2.0', id: this.requests, method, params }, signal })
    if (response.status === 401) throw this.signInAgain((await errorOf(response)).message)
    if (response.status === 429) {
      throw new CloudApiError(`${this.label} is rate limiting this token; try again in ${response.headers.get('retry-after') ?? 'a minute'} s`, 429, 'rate_limited')
    }
    if (!response.ok) {
      const { code, message } = await errorOf(response)
      throw new CloudApiError(message, response.status, code)
    }
    const text = await response.text()
    // Answered as an event stream, the response is the last message's data.
    const json = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).at(-1) ?? ''
      : text
    const message = JSON.parse(json) as { result?: unknown; error?: { code?: number; message?: string } }
    if (message.error) throw new CloudApiError(message.error.message ?? 'The cloud refused the request', 502, String(message.error.code ?? ''))
    return message.result
  }

  /** Calls one of the workspace's MCP tools; a tool error is thrown with the tool's own words. */
  async callTool<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult<T>> {
    const result = (await this.rpc('tools/call', { name, arguments: args }, signal)) as {
      content?: { type: string; text?: string }[]
      structuredContent?: unknown
      isError?: boolean
    }
    const text = (result.content ?? []).flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n')
    if (result.isError) throw new CloudApiError(text || `${name} failed`, 200, 'tool-error')
    return { structured: result.structuredContent as T, text }
  }

  /** The tools this session may call: how a status check proves the session works. */
  async listTools(signal?: AbortSignal): Promise<string[]> {
    const result = (await this.rpc('tools/list', {}, signal)) as { tools?: { name: string }[] }
    return (result.tools ?? []).map((tool) => tool.name)
  }
}
